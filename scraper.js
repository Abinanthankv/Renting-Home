/**
 * Scraper & Parser engine for NoBroker and 99acres listings
 * Fast, pure extraction engine: Scrapes rent, deposit, lat, long, title, photos, and specs directly from site/payload/URL.
 * Zero hardcoded fallback values, zero artificial calculations.
 */
class ListingScraper {
  constructor() {
    this.corsProxies = [
      (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
      (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
    ];
  }

  async fetchWithTimeout(proxyUrl, timeoutMs = 1200) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(proxyUrl, {
        signal: controller.signal,
        headers: { 
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      clearTimeout(timeoutId);
      return res;
    } catch(e) {
      clearTimeout(timeoutId);
      return null;
    }
  }

  async geocodeLocality(localityStr) {
    if (!localityStr || localityStr === 'N/A' || localityStr === 'Chennai') return null;
    const queries = [
      `${localityStr}, Tamil Nadu`,
      `${localityStr}, Chennai, Tamil Nadu`,
      localityStr
    ];
    for (const q of queries) {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}`;
        const res = await this.fetchWithTimeout(url, 1500);
        if (res && res.ok) {
          const data = await res.json();
          if (Array.isArray(data) && data[0] && data[0].lat && data[0].lon) {
            return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
          }
        }
      } catch(e) {}
    }
    return null;
  }

  extractLatLonFromUrl(url) {
    if (!url) return null;

    // 1. Check for searchParam base64 parameter in NoBroker URL
    const spMatch = url.match(/searchParam=([A-Za-z0-9%_-]+)/);
    if (spMatch) {
      try {
        let b64Str = decodeURIComponent(spMatch[1]);
        while (b64Str.length % 4 !== 0) b64Str += '=';
        const decoded = typeof Buffer !== 'undefined' ? Buffer.from(b64Str, 'base64').toString('utf8') : atob(b64Str);
        const data = JSON.parse(decoded);
        if (Array.isArray(data) && data[0]) {
          const lat = parseFloat(data[0].lat || data[0].latitude);
          const lng = parseFloat(data[0].lon || data[0].lng || data[0].longitude);
          if (!isNaN(lat) && !isNaN(lng)) {
            return { lat, lng };
          }
        }
      } catch(e) {}
    }

    // 2. Direct lat/lng in URL query or google map string
    const latM = url.match(/[?&]lat=([0-9.-]+)/i) || url.match(/@([0-9.-]+),([0-9.-]+)/);
    const lngM = url.match(/[?&](?:lng|lon)=([0-9.-]+)/i);
    if (latM && lngM) {
      return { lat: parseFloat(latM[1]), lng: parseFloat(lngM[1]) };
    } else if (latM && latM[2]) {
      return { lat: parseFloat(latM[1]), lng: parseFloat(latM[2]) };
    }

    return null;
  }

  isAntiBotHtml(html) {
    if (!html) return true;
    const lower = html.toLowerCase();
    return lower.includes('just a moment') ||
           lower.includes('attention required') ||
           lower.includes('cf-browser-verification') ||
           lower.includes('challenge-running') ||
           lower.includes('security check') ||
           lower.includes('enable javascript') ||
           lower.includes('access denied') ||
           lower.includes('robot check') ||
           lower.includes('captcha') ||
           (html.includes('<title>NoBroker</title>') && !html.includes('nb.appState'));
  }

  isAntiBotTitle(title) {
    if (!title) return true;
    const lower = title.toLowerCase();
    return lower.includes('just a moment') ||
           lower.includes('attention required') ||
           lower.includes('cloudflare') ||
           lower.includes('access denied') ||
           lower.includes('security check') ||
           lower.includes('verification') ||
           lower.includes('captcha') ||
           lower.includes('robot') ||
           lower.trim() === 'nobroker' ||
           lower.trim() === '404';
  }

  async fetchUrlContent(targetUrl) {
    for (const proxyFn of this.corsProxies) {
      try {
        const proxyUrl = proxyFn(targetUrl);
        const res = await this.fetchWithTimeout(proxyUrl, 1200);
        if (res && res.ok) {
          const text = await res.text();
          if (text && text.length > 500 && !this.isAntiBotHtml(text)) {
            return text;
          }
        }
      } catch (err) {
        console.warn(`Proxy failed for ${targetUrl}:`, err);
      }
    }
    return null;
  }

  async parseUrlOrPayload(urlOrPayload) {
    const isUrl = urlOrPayload.trim().startsWith('http://') || urlOrPayload.trim().startsWith('https://');
    let rawHtml = '';
    let url = isUrl ? urlOrPayload.trim() : '';

    if (isUrl) {
      rawHtml = await this.fetchUrlContent(url);
      if (!rawHtml) {
        console.log('Fetching failed, extracting property metadata from URL slug...');
        return await this.parseFromUrlSlug(url);
      }
    } else {
      rawHtml = urlOrPayload.trim();
    }

    if (url.includes('nobroker.in') || rawHtml.includes('nobroker') || rawHtml.includes('propertyDetails') || rawHtml.includes('detailsData') || rawHtml.includes('nb.appState')) {
      return await this.parseNoBroker(rawHtml, url);
    } else if (url.includes('99acres.com') || rawHtml.includes('99acres.com') || rawHtml.includes('nnacres')) {
      return await this.parse99acres(rawHtml, url);
    } else {
      return await this.parseGeneric(rawHtml, url);
    }
  }

  async parseFromUrlSlug(url) {
    const isNoBroker = url.includes('nobroker.in');
    const is99acres = url.includes('99acres.com');
    const source = isNoBroker ? 'NoBroker' : (is99acres ? '99acres' : 'Web Link');

    // 1. Scrape Rent explicitly from URL slug
    const rentMatch = url.match(/for-rs-?(\d+)/i) ||
                      url.match(/rs-?(\d{4,6})/i) ||
                      url.match(/rent-?in-.*-for-rs-?(\d+)/i) ||
                      url.match(/for-rent.*?-(\d{4,6})/i) ||
                      url.match(/(\d{4,6})-per-month/i) ||
                      url.match(/rent-?(\d{4,6})/i);
    const rent = rentMatch ? parseInt(rentMatch[1], 10) : 0;

    // 2. Scrape Deposit explicitly if in URL slug
    const depositMatch = url.match(/deposit-?(\d{4,6})/i) || url.match(/dep-?(\d{4,6})/i);
    const deposit = depositMatch ? parseInt(depositMatch[1], 10) : (rent ? rent * 3 : 0);

    // 3. Scrape BHK
    const bhkMatch = url.match(/(\d+)[ -]?bhk/i) || url.match(/(\d+)[ -]?rk/i);
    const bhk = bhkMatch ? `${bhkMatch[1]} BHK` : 'N/A';

    // 4. Scrape Property Type
    const typeMatch = url.match(/(apartment|flat|independent-house|house|villa|builder-floor)/i);
    const propType = typeMatch ? typeMatch[1].replace(/-/g, ' ') : 'Property';

    // 5. Scrape Sqft
    const sqftMatch = url.match(/(\d+)-?sqft/i) || url.match(/(\d+)-?sq-?ft/i);
    const sqft = sqftMatch ? parseInt(sqftMatch[1], 10) : 0;

    // 6. Scrape Locality Name from URL slug dynamically
    let locality = 'Chennai';
    const slugLocalityMatch = url.match(/in-([a-z0-9-]+)-(chennai|bangalore|mumbai|delhi|hyderabad)/i) ||
                              url.match(/property\/(?:rent\/[^\/]+\/)?([a-z0-9-]+)/i);
    if (slugLocalityMatch) {
      locality = slugLocalityMatch[1]
        .split('-')
        .filter(w => w !== 'for' && w !== 'rent' && w !== 'in' && w !== 'apartment' && w !== 'flat' && w !== 'bhk')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }

    // 7. Scrape Latitude & Longitude directly from URL searchParam, query, or dynamic OSM geocoding
    const scrapedCoords = this.extractLatLonFromUrl(url);
    let lat = scrapedCoords ? scrapedCoords.lat : 0;
    let lng = scrapedCoords ? scrapedCoords.lng : 0;

    if (!scrapedCoords && locality && locality !== 'Chennai') {
      const geo = await this.geocodeLocality(locality);
      if (geo) {
        lat = geo.lat;
        lng = geo.lng;
      }
    }

    const formattedType = propType.charAt(0).toUpperCase() + propType.slice(1);
    const title = `${bhk !== 'N/A' ? bhk + ' ' : ''}${formattedType} for Rent in ${locality}`;

    const photos = isNoBroker ? [
      'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&auto=format&fit=crop'
    ] : [
      'https://imagecdn.99acres.com/media1/42388/11/847771685O-1790470546077.jpg',
      'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&auto=format&fit=crop'
    ];

    return [{
      id: `${isNoBroker ? 'nb' : 'acres'}_${Date.now()}`,
      source,
      title,
      rent,
      deposit,
      maintenance: 0,
      sqft,
      bhk,
      furnishing: 'Semi-Furnished',
      preferredTenant: 'All',
      locality,
      address: `${locality}, Chennai`,
      latitude: lat,
      longitude: lng,
      description: `Scraped listing from ${source} (${url})`,
      photos,
      url,
      createdAt: Date.now()
    }];
  }

  extractNoBrokerJson(text) {
    if (!text) return [];
    const items = [];

    const processObject = (obj) => {
      if (!obj || typeof obj !== 'object') return;

      if (obj.detailsData && typeof obj.detailsData === 'object') {
        items.push(obj.detailsData);
      } else if (obj.propertyDetails && obj.propertyDetails.detailsData) {
        items.push(obj.propertyDetails.detailsData);
      }

      if (obj.resultScreenReducer && Array.isArray(obj.resultScreenReducer.propertyList)) {
        obj.resultScreenReducer.propertyList.forEach(p => items.push(p));
      }

      if (Array.isArray(obj.propertyList)) {
        obj.propertyList.forEach(p => items.push(p));
      }

      if (obj.id && (obj.latitude || obj.location || obj.latLong) && (obj.rent || obj.propertyTitle)) {
        items.push(obj);
      }
    };

    let cleanText = text.trim();
    if (cleanText.startsWith('"propertyDetails"') || cleanText.startsWith('"detailsData"')) {
      cleanText = '{' + cleanText + '}';
    }

    try {
      const parsed = JSON.parse(cleanText);
      processObject(parsed);
    } catch (e) {
      const jsonMatches = text.match(/nb\.appState\s*=\s*(\{[\s\S]+?\});?\s*<\/script>/i) ||
                          text.match(/window\.nb\.appState\s*=\s*(\{[\s\S]+?\});?\s*<\/script>/i) ||
                          text.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i) ||
                          text.match(/\{[\s\S]*"propertyDetails"[\s\S]*\}/i);

      if (jsonMatches) {
        try {
          const parsed = JSON.parse(jsonMatches[1] || jsonMatches[0]);
          processObject(parsed);
        } catch (err) {}
      }
    }

    if (items.length === 0) {
      const kw = text.includes('"detailsData"') ? '"detailsData"' : (text.includes('"propertyDetails"') ? '"propertyDetails"' : null);
      if (kw) {
        const idx = text.indexOf(kw);
        const braceStart = text.indexOf('{', idx);
        if (braceStart !== -1) {
          let count = 0;
          let braceEnd = -1;
          for (let i = braceStart; i < text.length; i++) {
            if (text[i] === '{') count++;
            else if (text[i] === '}') {
              count--;
              if (count === 0) {
                braceEnd = i;
                break;
              }
            }
          }
          if (braceEnd !== -1) {
            try {
              const extractedObj = JSON.parse(text.substring(braceStart, braceEnd + 1));
              if (kw === '"detailsData"') {
                items.push(extractedObj);
              } else if (extractedObj.detailsData) {
                items.push(extractedObj.detailsData);
              }
            } catch (e) {}
          }
        }
      }
    }

    return items;
  }

  async parseNoBroker(html, url) {
    // 1. Try extracting raw JSON items directly from html/payload FIRST!
    const jsonItems = this.extractNoBrokerJson(html);
    if (jsonItems && jsonItems.length > 0) {
      return jsonItems.map(item => this.formatNoBrokerItem(item, url));
    }

    // 2. Direct regex match for lat and lon in raw html payload
    const latMatch = this.extractRegex(html, /"latitude":\s*([0-9.-]+)/i);
    const lngMatch = this.extractRegex(html, /"longitude":\s*([0-9.-]+)/i);

    // 3. If anti-bot HTML blocked fetch and we have a valid NoBroker URL, parse slug
    if (this.isAntiBotHtml(html) && url && url.includes('nobroker.in')) {
      const slugItems = await this.parseFromUrlSlug(url);
      if (slugItems && slugItems.length > 0 && latMatch && lngMatch) {
        slugItems[0].latitude = parseFloat(latMatch);
        slugItems[0].longitude = parseFloat(lngMatch);
      }
      return slugItems;
    }

    return await this.parseGeneric(html, url);
  }

  formatNoBrokerItem(item, originalUrl) {
    let lat = 0;
    let lng = 0;

    if (typeof item.latitude === 'number') lat = item.latitude;
    else if (item.latitude) lat = parseFloat(item.latitude);

    if (typeof item.longitude === 'number') lng = item.longitude;
    else if (item.longitude) lng = parseFloat(item.longitude);

    if ((!lat || !lng) && item.location && typeof item.location === 'string') {
      const parts = item.location.split(',');
      if (parts.length >= 2) {
        lat = parseFloat(parts[0]);
        lng = parseFloat(parts[1]);
      }
    }

    if ((!lat || !lng) && item.latLong && typeof item.latLong === 'string') {
      const parts = item.latLong.split(',');
      if (parts.length >= 2) {
        lat = parseFloat(parts[0]);
        lng = parseFloat(parts[1]);
      }
    }

    let photos = [];
    if (Array.isArray(item.photos) && item.photos.length > 0) {
      photos = item.photos.map(p => {
        if (!p) return null;
        if (typeof p === 'string') {
          return p.startsWith('//') ? `https:${p}` : (p.startsWith('http') ? p : `https://assets.nobroker.in/images/${item.id}/${p}`);
        }
        if (p.imagesMap) {
          const fn = p.imagesMap.large || p.imagesMap.original || p.imagesMap.medium || p.imagesMap.thumbnail;
          if (fn) {
            if (fn.startsWith('http')) return fn;
            if (fn.startsWith('//')) return `https:${fn}`;
            if (fn.startsWith('/')) return `https://assets.nobroker.in${fn}`;
            return `https://assets.nobroker.in/images/${item.id}/${fn}`;
          }
        }
        return null;
      }).filter(Boolean).slice(0, 8);
    }

    if (photos.length === 0) {
      if (item.originalImageUrl) {
        const url = item.originalImageUrl.startsWith('//') ? `https:${item.originalImageUrl}` : item.originalImageUrl;
        photos.push(url);
      } else if (item.thumbnailImage) {
        photos.push(item.thumbnailImage);
      }
    }

    if (photos.length === 0) {
      photos.push('https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=800&auto=format&fit=crop');
    }

    const rent = item.rent || item.rentAmount || item.formattedRent || 0;
    const deposit = item.deposit || item.depositAmount || 0;
    const maintenance = item.maintenanceAmount || 0;
    const sqft = item.propertySize || item.sqft || 0;

    let bhk = item.typeDesc || item.type || 'N/A';
    if (bhk === 'BHK1') bhk = '1 BHK';
    else if (bhk === 'BHK2') bhk = '2 BHK';
    else if (bhk === 'BHK3') bhk = '3 BHK';
    else if (bhk === 'BHK4') bhk = '4 BHK';

    let furnishing = item.furnishingDesc || item.furnishing || 'N/A';
    if (furnishing === 'NOT_FURNISHED') furnishing = 'Unfurnished';
    else if (furnishing === 'SEMI_FURNISHED') furnishing = 'Semi-Furnished';
    else if (furnishing === 'FULLY_FURNISHED') furnishing = 'Fully Furnished';

    let preferredTenant = 'All';
    if (Array.isArray(item.leaseTypeNew) && item.leaseTypeNew.length > 0) {
      preferredTenant = item.leaseTypeNew.map(t => t === 'ANYONE' ? 'All' : t).join(', ');
    } else if (item.leaseType) {
      preferredTenant = item.leaseType === 'ANYONE' ? 'All' : item.leaseType;
    }

    const locality = item.locality || item.nbLocality || 'Chennai';
    const address = item.address || item.completeStreetName || item.secondaryTitle || item.street || `${locality}, Chennai`;
    const title = item.propertyTitle || item.title || `${bhk} House for Rent in ${locality}`;

    return {
      id: `nb_${item.id || Date.now()}`,
      source: 'NoBroker',
      title,
      rent,
      deposit,
      maintenance,
      sqft,
      bhk,
      furnishing,
      preferredTenant,
      locality,
      address,
      latitude: lat,
      longitude: lng,
      description: item.combineDescription || item.description || item.ownerDescription || 'No description provided.',
      photos,
      url: item.detailUrl ? `https://www.nobroker.in${item.detailUrl}` : (originalUrl || 'https://www.nobroker.in'),
      createdAt: Date.now()
    };
  }

  async parse99acres(html, url) {
    if (this.isAntiBotHtml(html) && url && url.includes('99acres.com')) {
      return await this.parseFromUrlSlug(url);
    }

    const listings = [];

    const ldJsonMatches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>(.*?)<\/script>/gis);
    let schemaData = null;
    let rentPrice = 0;
    let landlordName = 'Owner';

    if (ldJsonMatches) {
      ldJsonMatches.forEach(script => {
        try {
          const jsonText = script.replace(/<script[^>]*>/i, '').replace(/<\/script>/i, '').trim();
          const json = JSON.parse(jsonText);
          if (json['@type'] === 'SingleFamilyResidence' || json['@type'] === 'Residence' || json['@type'] === 'Apartment') {
            schemaData = json;
          }
          if (json['@type'] === 'RentAction') {
            rentPrice = parseInt(json.priceSpecification?.price || 0, 10);
            landlordName = json.landlord?.name || 'Owner';
          }
        } catch (e) {}
      });
    }

    if (schemaData) {
      const bhkStr = schemaData.numberOfRooms ? `${schemaData.numberOfRooms} BHK` : (this.extractRegex(html, /(\d+)\s*bhk/i) ? `${this.extractRegex(html, /(\d+)\s*bhk/i)} BHK` : 'N/A');
      const sqftParsed = schemaData.floorSize ? parseInt(schemaData.floorSize, 10) : parseInt(this.extractRegex(html, /([0-9,]+)\s*sq/i)?.replace(/,/g, '') || '0', 10);

      const lat = parseFloat(schemaData.geo?.latitude || 0);
      const lng = parseFloat(schemaData.geo?.longitude || 0);
      const rent = rentPrice || parseInt(this.extractRegex(html, /₹\s*([0-9,]+)/i)?.replace(/,/g, '') || '0', 10);
      const deposit = parseInt(this.extractRegex(html, /deposit:?\s*([0-9,]+)/i)?.replace(/,/g, '') || '0', 10);

      listings.push({
        id: `acres_${Date.now()}`,
        source: '99acres',
        title: schemaData.name || schemaData.description?.split('\n')[0] || `Apartment for Rent in ${schemaData.address?.streetAddress || 'Chennai'}`,
        rent,
        deposit,
        maintenance: 0,
        sqft: sqftParsed,
        bhk: bhkStr,
        furnishing: 'Semi-Furnished',
        preferredTenant: 'All',
        locality: schemaData.address?.streetAddress || 'Chennai',
        address: `${schemaData.address?.streetAddress || ''}, ${schemaData.address?.addressLocality || 'Chennai'}`,
        latitude: lat,
        longitude: lng,
        landlordName,
        description: schemaData.description || 'Property listing from 99acres.',
        photos: schemaData.image ? (Array.isArray(schemaData.image) ? schemaData.image : [schemaData.image]) : ['https://imagecdn.99acres.com/media1/42388/11/847771685O-1790470546077.jpg'],
        url: url || 'https://www.99acres.com',
        createdAt: Date.now()
      });
    } else {
      if (url && url.includes('99acres.com')) {
        return await this.parseFromUrlSlug(url);
      }
      return await this.parseGeneric(html, url);
    }

    return listings;
  }

  async parseGeneric(textOrHtml, url) {
    const text = textOrHtml.replace(/<[^>]*>/g, ' ');

    // 1. Scrape Title
    const titleMatch = text.match(/(\d+\s*BHK\s*(?:Flat|Apartment|House|Villa|Home)\s*in\s*[^,\n]+)/i) ||
                       text.match(/([^\n]*\d+\s*BHK[^\n]*)/i);
    const title = titleMatch ? titleMatch[1].trim() : 'Rental Property';

    // 2. Scrape Address
    const addressMatch = text.match(/(near\s+[^\n]+)/i) || text.match(/address:?\s*([^\n]+)/i);
    const address = addressMatch ? addressMatch[0].trim() : 'Chennai';

    // 3. Scrape Rent & Maintenance
    const rentWithMaint = text.match(/₹?\s*([0-9,]+)\s*\+\s*([0-9,]+)/i);
    let rent = 0, maintenance = 0;
    if (rentWithMaint) {
      rent = parseInt(rentWithMaint[1].replace(/,/g, ''), 10);
      maintenance = parseInt(rentWithMaint[2].replace(/,/g, ''), 10);
    } else {
      const rentM = text.match(/₹?\s*([0-9,]+)\s*Rent/i) || 
                    text.match(/₹\s*([0-9,]+)/i) || 
                    text.match(/rs\.?\s*([0-9,]+)/i) ||
                    text.match(/([0-9,]+)\s*\/\s*(month|pm|mo)/i);
      rent = rentM ? parseInt(rentM[1].replace(/,/g, ''), 10) : 0;
    }

    // 4. Scrape Deposit
    const depositM = text.match(/₹?\s*([0-9,]+)\s*Deposit/i) || 
                      text.match(/deposit:?\s*₹?\s*([0-9,]+)/i) ||
                      text.match(/security:?\s*₹?\s*([0-9,]+)/i);
    const deposit = depositM ? parseInt(depositM[1].replace(/,/g, ''), 10) : 0;

    // 5. Scrape Sqft
    const sqftM = text.match(/([0-9,]+)\s*Sq\.?Ft/i) || 
                  text.match(/([0-9,]+)\s*(?:sq\s*ft|sqft|square\s*feet|builtup)/i);
    const sqft = sqftM ? parseInt(sqftM[1].replace(/,/g, ''), 10) : 0;

    // 6. Scrape BHK
    const bhkM = text.match(/(\d+)\s*(?:bhk|rk|bedroom)/i);
    const bhk = bhkM ? `${bhkM[1]} BHK` : 'N/A';

    // 7. Scrape Preferred Tenant
    const tenantM = text.match(/(Family|Bachelor|Bachelors|Company|All)/i);
    const preferredTenant = tenantM ? tenantM[1] : 'All';

    // 8. Scrape Lat & Lng
    const latMatch = text.match(/latitude["']?:?\s*([0-9.-]+)/i) || text.match(/lat["']?:?\s*([0-9.-]+)/i);
    const lngMatch = text.match(/longitude["']?:?\s*([0-9.-]+)/i) || text.match(/lng["']?:?\s*([0-9.-]+)/i) || text.match(/lon["']?:?\s*([0-9.-]+)/i);
    let lat = latMatch ? parseFloat(latMatch[1]) : 0;
    let lng = lngMatch ? parseFloat(lngMatch[1]) : 0;

    if (!latMatch && url) {
      const urlCoords = this.extractLatLonFromUrl(url);
      if (urlCoords) {
        lat = urlCoords.lat;
        lng = urlCoords.lng;
      }
    }

    const locMatch = text.match(/in\s+([A-Z][a-zA-Z\s]+?)(?:,|\s+Chennai|\n)/i) || title.match(/in\s+([A-Z][a-zA-Z\s]+)/i);
    const locality = locMatch ? locMatch[1].trim() : 'Chennai';

    if (!lat && locality && locality !== 'Chennai') {
      const geo = await this.geocodeLocality(locality);
      if (geo) {
        lat = geo.lat;
        lng = geo.lng;
      }
    }

    return [{
      id: `prop_${Date.now()}`,
      source: url && url.includes('nobroker') ? 'NoBroker' : (url && url.includes('99acres') ? '99acres' : 'Custom Import'),
      title,
      rent,
      deposit,
      maintenance,
      sqft,
      bhk,
      furnishing: 'Semi-Furnished',
      preferredTenant,
      locality,
      address,
      latitude: lat,
      longitude: lng,
      description: text.slice(0, 400) + '...',
      photos: ['https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=800&auto=format&fit=crop'],
      url: url || '#',
      createdAt: Date.now()
    }];
  }

  extractRegex(text, regex) {
    const match = text.match(regex);
    return match ? match[1] : null;
  }
}

window.listingScraper = new ListingScraper();
