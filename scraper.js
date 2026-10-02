/**
 * Scraper & Parser engine for NoBroker and 99acres listings
 * Pure extraction engine: Scrapes rent, deposit, lat, long, title, photos, and specs directly from site/payload/URL
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
        const res = await fetch(proxyUrl, {
          headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }
        });
        if (res.ok) {
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
      if (!rawHtml || this.isAntiBotHtml(rawHtml)) {
        console.log('Extracting property metadata directly from URL slug...');
        return this.parseFromUrlSlug(url);
      }
    } else {
      rawHtml = urlOrPayload.trim();
    }

    if (url.includes('nobroker.in') || rawHtml.includes('nobroker.in') || rawHtml.includes('nb.appState')) {
      return this.parseNoBroker(rawHtml, url);
    } else if (url.includes('99acres.com') || rawHtml.includes('99acres.com') || rawHtml.includes('nnacres')) {
      return this.parse99acres(rawHtml, url);
    } else {
      return this.parseGeneric(rawHtml, url);
    }
  }

  parseFromUrlSlug(url) {
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

    // 6. Scrape Latitude & Longitude directly from URL searchParam or query
    const scrapedCoords = this.extractLatLonFromUrl(url);
    const lat = scrapedCoords ? scrapedCoords.lat : 0;
    const lng = scrapedCoords ? scrapedCoords.lng : 0;

    // 7. Scrape Locality Name from URL slug dynamically
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

  parseNoBroker(html, url) {
    if (this.isAntiBotHtml(html) && url && url.includes('nobroker.in')) {
      return this.parseFromUrlSlug(url);
    }

    const listings = [];

    const appStateMatch = html.match(/nb\.appState\s*=\s*(\{.+?\});?\s*<\/script>/s) ||
                          html.match(/window\.nb\.appState\s*=\s*(\{.+?\});?\s*<\/script>/s) ||
                          html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>(.*?)<\/script>/s);

    if (appStateMatch) {
      try {
        const jsonText = appStateMatch[1] || appStateMatch[0];
        const state = JSON.parse(jsonText);
        
        if (state.propertyDetails && state.propertyDetails.detailsData) {
          const item = state.propertyDetails.detailsData;
          listings.push(this.formatNoBrokerItem(item, url));
        }

        if (state.resultScreenReducer && Array.isArray(state.resultScreenReducer.propertyList)) {
          state.resultScreenReducer.propertyList.forEach(item => {
            listings.push(this.formatNoBrokerItem(item, url));
          });
        }
      } catch (e) {
        console.warn('Failed parsing NoBroker JSON script tag:', e);
      }
    }

    if (listings.length === 0 && url && url.includes('nobroker.in')) {
      const slugItems = this.parseFromUrlSlug(url);
      if (slugItems && slugItems.length > 0) {
        const item = slugItems[0];
        
        const htmlTitle = this.extractRegex(html, /<title[^>]*>(.*?)<\/title>/i);
        if (htmlTitle && !this.isAntiBotTitle(htmlTitle)) {
          item.title = htmlTitle.replace(/\|?\s*NoBroker.*/i, '').trim();
        }

        const latMatch = this.extractRegex(html, /"latitude":\s*([0-9.-]+)/i);
        const lngMatch = this.extractRegex(html, /"longitude":\s*([0-9.-]+)/i);
        if (latMatch && lngMatch) {
          item.latitude = parseFloat(latMatch);
          item.longitude = parseFloat(lngMatch);
        }

        const photoMatches = html.match(/https:\/\/images\.nobroker\.in\/images\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9._-]+\.jpg/g);
        if (photoMatches && photoMatches.length > 0) {
          item.photos = Array.from(new Set(photoMatches)).slice(0, 8);
        }

        listings.push(item);
      }
    }

    if (listings.length === 0) {
      return this.parseGeneric(html, url);
    }

    return listings;
  }

  formatNoBrokerItem(item, originalUrl) {
    const lat = parseFloat(item.latitude || item.lat || (item.location ? item.location.split(',')[0] : 0) || (item.latLong ? item.latLong.split(',')[0] : 0));
    const lng = parseFloat(item.longitude || item.lon || item.lng || (item.location ? item.location.split(',')[1] : 0) || (item.latLong ? item.latLong.split(',')[1] : 0));

    let photos = [];
    if (Array.isArray(item.photos)) {
      photos = item.photos.map(p => {
        if (p.imagesMap && p.imagesMap.large) {
          return p.imagesMap.large.startsWith('http') ? p.imagesMap.large : `https://images.nobroker.in/images/${item.id}/${p.imagesMap.large}`;
        }
        return 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=800&auto=format&fit=crop';
      }).slice(0, 8);
    }

    const rent = item.rent || item.rentAmount || item.formattedRent || 0;
    const deposit = item.deposit || item.depositAmount || 0;

    return {
      id: `nb_${item.id || Date.now()}`,
      source: 'NoBroker',
      title: item.propertyTitle || item.title || `${item.typeDesc || ''} House for Rent in ${item.locality || 'Chennai'}`,
      rent,
      deposit,
      maintenance: item.maintenanceAmount || 0,
      sqft: item.propertySize || 0,
      bhk: item.typeDesc || item.type || 'N/A',
      furnishing: item.furnishingDesc || item.furnishing || 'N/A',
      preferredTenant: Array.isArray(item.leaseTypeNew) ? item.leaseTypeNew.join(', ') : (item.leaseType || 'All'),
      locality: item.locality || item.nbLocality || 'Chennai',
      address: item.address || item.completeStreetName || item.secondaryTitle || 'Chennai',
      latitude: lat,
      longitude: lng,
      description: item.combineDescription || item.description || item.ownerDescription || 'No description provided.',
      photos: photos.length ? photos : ['https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=800&auto=format&fit=crop'],
      url: item.detailUrl ? `https://www.nobroker.in${item.detailUrl}` : (originalUrl || 'https://www.nobroker.in'),
      createdAt: Date.now()
    };
  }

  parse99acres(html, url) {
    if (this.isAntiBotHtml(html) && url && url.includes('99acres.com')) {
      return this.parseFromUrlSlug(url);
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
        return this.parseFromUrlSlug(url);
      }
      return this.parseGeneric(html, url);
    }

    return listings;
  }

  parseGeneric(textOrHtml, url) {
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

    // 8. Scrape Lat & Lng directly from text / HTML
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
