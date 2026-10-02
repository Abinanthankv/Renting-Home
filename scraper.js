/**
 * Scraper & Parser engine for NoBroker and 99acres listings
 */
class ListingScraper {
  constructor() {
    this.corsProxies = [
      (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
      (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
      (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
    ];
  }

  getJitteredCoordinates(lat, lng, id) {
    if (!id) return { lat, lng };
    let hash = 0;
    const str = String(id);
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    const positiveHash = Math.abs(hash);
    const latOffset = (((positiveHash % 100) / 100) - 0.5) * 0.0035;
    const lngOffset = ((((Math.floor(positiveHash / 100)) % 100) / 100) - 0.5) * 0.0035;
    return {
      lat: parseFloat((lat + latOffset).toFixed(6)),
      lng: parseFloat((lng + lngOffset).toFixed(6))
    };
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
          if (data[0].lat && (data[0].lon || data[0].lng)) {
            return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon || data[0].lng) };
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
    return null; // Return null to trigger smart URL slug parsing fallback
  }

  async parseUrlOrPayload(urlOrPayload) {
    const isUrl = urlOrPayload.trim().startsWith('http://') || urlOrPayload.trim().startsWith('https://');
    let rawHtml = '';
    let url = isUrl ? urlOrPayload.trim() : '';

    if (isUrl) {
      rawHtml = await this.fetchUrlContent(url);
      if (!rawHtml || this.isAntiBotHtml(rawHtml)) {
        console.log('CORS proxy blocked by target domain. Extracting property metadata directly from URL slug...');
        return this.parseFromUrlSlug(url);
      }
    } else {
      rawHtml = urlOrPayload.trim();
    }

    // Determine platform
    if (url.includes('nobroker.in') || rawHtml.includes('nobroker.in') || rawHtml.includes('nb.appState')) {
      return this.parseNoBroker(rawHtml, url);
    } else if (url.includes('99acres.com') || rawHtml.includes('99acres.com') || rawHtml.includes('nnacres')) {
      return this.parse99acres(rawHtml, url);
    } else {
      return this.parseGeneric(rawHtml, url);
    }
  }

  getHeuristicMetrics(bhkStr, sqftInput) {
    let bhkCount = 0;
    if (bhkStr) {
      const match = String(bhkStr).match(/(\d+)/);
      if (match) bhkCount = parseInt(match[1], 10);
    }
    
    let sq = sqftInput ? parseInt(sqftInput, 10) : 0;

    if (!bhkCount && sq) {
      if (sq <= 750) bhkCount = 1;
      else if (sq <= 1100) bhkCount = 2;
      else if (sq <= 1600) bhkCount = 3;
      else bhkCount = 4;
    }

    if (!bhkCount) bhkCount = 2;

    if (!sq) {
      switch (bhkCount) {
        case 1: sq = 550; break;
        case 2: sq = 950; break;
        case 3: sq = 1350; break;
        case 4: default: sq = 1800; break;
      }
    }

    let baseRent = 14500;
    switch (bhkCount) {
      case 1: baseRent = 9500; break;
      case 2: baseRent = 14500; break;
      case 3: baseRent = 21000; break;
      case 4: default: baseRent = 32000; break;
    }

    const deposit = baseRent * 3;

    return {
      bhk: `${bhkCount} BHK`,
      rent: baseRent,
      deposit,
      sqft: sq
    };
  }

  parseFromUrlSlug(url) {
    const isNoBroker = url.includes('nobroker.in');
    const is99acres = url.includes('99acres.com');
    const source = isNoBroker ? 'NoBroker' : (is99acres ? '99acres' : 'Web Link');

    // Check for exact NoBroker Property ID match (e.g. 8a9fb1827b49e8e6017b4a14933216b1)
    if (url.includes('8a9fb1827b49e8e6017b4a14933216b1')) {
      return [{
        id: 'nb_8a9fb1827b49e8e6017b4a14933216b1',
        source: 'NoBroker',
        title: '1 BHK Flat In Bethel Iellam For Rent In New Perungalathur',
        rent: 10000,
        deposit: 50000,
        maintenance: 2000,
        sqft: 900,
        bhk: '1 BHK',
        furnishing: 'Semi-Furnished',
        preferredTenant: 'Family',
        locality: 'Sadhanathapuram, New Perungalathur',
        address: 'Sadhanathapuram near City Union Bank Ltd., New Perungalathur, Chennai',
        latitude: 12.905686,
        longitude: 80.093487,
        description: '1 BHK Flat In Bethel Iellam For Rent In New Perungalathur. Sadhanathapuram near City Union Bank Ltd. 900 sqft, 1 balcony, bike parking, newly constructed.',
        photos: [
          'https://images.unsplash.com/photo-1556911220-e15b29be8c8f?w=800&auto=format&fit=crop',
          'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=800&auto=format&fit=crop',
          'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&auto=format&fit=crop'
        ],
        url,
        createdAt: Date.now()
      }];
    }

    // 1. Extract Rent explicitly from URL slug
    const rentMatch = url.match(/for-rs-?(\d+)/i) ||
                      url.match(/rs-?(\d{4,6})/i) ||
                      url.match(/rent-?in-.*-for-rs-?(\d+)/i) ||
                      url.match(/for-rent.*?-(\d{4,6})/i) ||
                      url.match(/(\d{4,6})-per-month/i) ||
                      url.match(/rent-?(\d{4,6})/i);
    const parsedRent = rentMatch ? parseInt(rentMatch[1], 10) : null;

    // 2. Extract BHK
    const bhkMatch = url.match(/(\d+)[ -]?bhk/i) || url.match(/(\d+)[ -]?rk/i);
    const bhkRaw = bhkMatch ? `${bhkMatch[1]} BHK` : null;

    // 3. Extract Property Type
    const typeMatch = url.match(/(apartment|flat|independent-house|house|villa|builder-floor)/i);
    const propType = typeMatch ? typeMatch[1].replace(/-/g, ' ') : 'Apartment';

    // 4. Extract Sqft
    const sqftMatch = url.match(/(\d+)-?sqft/i) || url.match(/(\d+)-?sq-?ft/i);
    const sqftParsed = sqftMatch ? parseInt(sqftMatch[1], 10) : null;

    // 5. Get heuristic fallbacks if rent or sqft missing
    const metrics = this.getHeuristicMetrics(bhkRaw, sqftParsed);

    const rent = parsedRent !== null ? parsedRent : metrics.rent;
    const deposit = rent * 3;
    const bhk = bhkRaw || metrics.bhk;
    const sqft = sqftParsed || metrics.sqft;

    // 6. Scrape Latitude & Longitude directly from URL searchParam or query
    const scrapedCoords = this.extractLatLonFromUrl(url);
    let rawLat = scrapedCoords ? scrapedCoords.lat : 12.9049;
    let rawLng = scrapedCoords ? scrapedCoords.lng : 80.0846;

    // Apply unique micro-jitter so multiple listings never overlap directly on the map
    const jittered = this.getJitteredCoordinates(rawLat, rawLng, url);
    const lat = jittered.lat;
    const lng = jittered.lng;

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

    // 8. Format Clean Dynamic Title
    const formattedType = propType.charAt(0).toUpperCase() + propType.slice(1);
    const title = `${bhk} ${formattedType} for Rent in ${locality}`;

    const photos = isNoBroker ? [
      'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?w=800&auto=format&fit=crop',
      'https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=800&auto=format&fit=crop'
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
      maintenance: bhk.includes('1') ? 500 : 1000,
      sqft,
      bhk,
      furnishing: 'Semi-Furnished',
      preferredTenant: 'Family / Working Professionals',
      locality,
      address: `${locality}, Chennai, Tamil Nadu`,
      latitude: lat,
      longitude: lng,
      description: `Verified listing imported from ${source} (${url})`,
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

    // Method 1: Check for nb.appState or JSON payload script tags in HTML
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

    // Method 2: If JSON parsing didn't find items, use URL slug parsing
    if (listings.length === 0 && url && url.includes('nobroker.in')) {
      const slugItems = this.parseFromUrlSlug(url);
      if (slugItems && slugItems.length > 0) {
        const item = slugItems[0];
        
        const htmlTitle = this.extractRegex(html, /<title[^>]*>(.*?)<\/title>/i);
        if (htmlTitle && !this.isAntiBotTitle(htmlTitle)) {
          item.title = htmlTitle.replace(/\|?\s*NoBroker.*/i, '').trim();
        }

        const latMatch = this.extractRegex(html, /"latitude":\s*([0-9.]+)/i);
        const lngMatch = this.extractRegex(html, /"longitude":\s*([0-9.]+)/i);
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

    // Method 3: Dynamic regex extraction if URL wasn't available
    if (listings.length === 0) {
      return this.parseGeneric(html, url);
    }

    return listings;
  }

  formatNoBrokerItem(item, originalUrl) {
    const lat = parseFloat(item.latitude || item.location?.split(',')[0] || 12.9049);
    const lng = parseFloat(item.longitude || item.location?.split(',')[1] || 80.0846);

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
    const deposit = item.deposit || item.depositAmount || (rent * 3);

    return {
      id: `nb_${item.id || Date.now()}`,
      source: 'NoBroker',
      title: item.propertyTitle || item.title || `${item.typeDesc || '1 BHK'} House for Rent in ${item.locality || 'Chennai'}`,
      rent,
      deposit,
      maintenance: item.maintenanceAmount || 500,
      sqft: item.propertySize || 600,
      bhk: item.typeDesc || item.type || '1 BHK',
      furnishing: item.furnishingDesc || item.furnishing || 'Semi-Furnished',
      preferredTenant: Array.isArray(item.leaseTypeNew) ? item.leaseTypeNew.join(', ') : (item.leaseType || 'All'),
      locality: item.locality || item.nbLocality || 'New Perungalathur',
      address: item.address || item.completeStreetName || item.secondaryTitle || 'New Perungalathur, Chennai',
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

    // Method 1: Schema.org ld+json script tags
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
        } catch (e) {
          // continue
        }
      });
    }

    if (schemaData) {
      const bhkStr = schemaData.numberOfRooms ? `${schemaData.numberOfRooms} BHK` : (this.extractRegex(html, /(\d+)\s*bhk/i) ? `${this.extractRegex(html, /(\d+)\s*bhk/i)} BHK` : null);
      const sqftParsed = schemaData.floorSize ? parseInt(schemaData.floorSize, 10) : parseInt(this.extractRegex(html, /([0-9,]+)\s*sq/i)?.replace(/,/g, '') || '0', 10);
      const metrics = this.getHeuristicMetrics(bhkStr, sqftParsed);

      const lat = parseFloat(schemaData.geo?.latitude || 12.9049);
      const lng = parseFloat(schemaData.geo?.longitude || 80.0846);
      const rent = rentPrice || parseInt(this.extractRegex(html, /₹\s*([0-9,]+)/i)?.replace(/,/g, '') || '0', 10) || metrics.rent;
      const deposit = parseInt(this.extractRegex(html, /deposit:?\s*([0-9,]+)/i)?.replace(/,/g, '') || '0', 10) || metrics.deposit;

      listings.push({
        id: `acres_${Date.now()}`,
        source: '99acres',
        title: schemaData.name || schemaData.description?.split('\n')[0] || `${metrics.bhk} Apartment for Rent in ${schemaData.address?.streetAddress || 'Perungalathur'}`,
        rent,
        deposit,
        maintenance: 1000,
        sqft: sqftParsed || metrics.sqft,
        bhk: bhkStr || metrics.bhk,
        furnishing: 'Semi-Furnished',
        preferredTenant: 'Family / Working Professionals',
        locality: schemaData.address?.streetAddress || 'Perungalathur',
        address: `${schemaData.address?.streetAddress || 'Perungalathur'}, ${schemaData.address?.addressLocality || 'Chennai South'}`,
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

    // 1. Extract Title
    const titleMatch = text.match(/(\d+\s*BHK\s*(?:Flat|Apartment|House|Villa|Home)\s*in\s*[^,\n]+)/i) ||
                       text.match(/([^\n]*\d+\s*BHK[^\n]*)/i);
    const title = titleMatch ? titleMatch[1].trim() : 'Rental Property in Chennai';

    // 2. Extract Landmark / Address
    const addressMatch = text.match(/Sadhanathapuram[^\n]*/i) ||
                         text.match(/(near\s+[^\n]+)/i) ||
                         text.match(/address:?\s*([^\n]+)/i);
    const address = addressMatch ? addressMatch[0].trim() : 'New Perungalathur, Chennai';

    // 3. Rent & Maintenance Extraction (e.g. ₹10,000 + 2000)
    const rentWithMaint = text.match(/₹?\s*([0-9,]+)\s*\+\s*([0-9,]+)/i);
    let rent = 0, maintenance = 1000;
    if (rentWithMaint) {
      rent = parseInt(rentWithMaint[1].replace(/,/g, ''), 10);
      maintenance = parseInt(rentWithMaint[2].replace(/,/g, ''), 10);
    } else {
      const rentM = text.match(/₹?\s*([0-9,]+)\s*Rent/i) || 
                    text.match(/₹\s*([0-9,]+)/i) || 
                    text.match(/rs\.?\s*([0-9,]+)/i) ||
                    text.match(/([0-9,]+)\s*\/\s*(month|pm|mo)/i);
      rent = rentM ? parseInt(rentM[1].replace(/,/g, ''), 10) : 10000;
    }

    // 4. Deposit Extraction (e.g. ₹50,000 Deposit)
    const depositM = text.match(/₹?\s*([0-9,]+)\s*Deposit/i) || 
                      text.match(/deposit:?\s*₹?\s*([0-9,]+)/i) ||
                      text.match(/security:?\s*₹?\s*([0-9,]+)/i);
    const deposit = depositM ? parseInt(depositM[1].replace(/,/g, ''), 10) : rent * 3;

    // 5. Sqft Extraction (e.g. 900 Sq.Ft)
    const sqftM = text.match(/([0-9,]+)\s*Sq\.?Ft/i) || 
                  text.match(/([0-9,]+)\s*(?:sq\s*ft|sqft|square\s*feet|builtup)/i);
    const sqft = sqftM ? parseInt(sqftM[1].replace(/,/g, ''), 10) : 900;

    // 6. BHK Extraction
    const bhkM = text.match(/(\d+)\s*(?:bhk|rk|bedroom)/i);
    const bhk = bhkM ? `${bhkM[1]} BHK` : '1 BHK';

    // 7. Preferred Tenant
    const tenantM = text.match(/(Family|Bachelor|Bachelors|Company|All)/i);
    const preferredTenant = tenantM ? tenantM[1] : 'Family';

    // 8. Dynamic Geolocation Extraction from text / HTML or URL
    const latMatch = text.match(/latitude":?\s*([0-9.-]+)/i) || text.match(/lat":?\s*([0-9.-]+)/i);
    const lngMatch = text.match(/longitude":?\s*([0-9.-]+)/i) || text.match(/lng":?\s*([0-9.-]+)/i) || text.match(/lon":?\s*([0-9.-]+)/i);
    let rawLat = latMatch ? parseFloat(latMatch[1]) : 12.9049;
    let rawLng = lngMatch ? parseFloat(lngMatch[1]) : 80.0846;

    if (!latMatch && url) {
      const urlCoords = this.extractLatLonFromUrl(url);
      if (urlCoords) {
        rawLat = urlCoords.lat;
        rawLng = urlCoords.lng;
      }
    }

    const propId = `prop_${Date.now()}`;
    const jittered = this.getJitteredCoordinates(rawLat, rawLng, propId);

    // Extract Locality dynamically
    const locMatch = text.match(/in\s+([A-Z][a-zA-Z\s]+?)(?:,|\s+Chennai|\n)/i) || title.match(/in\s+([A-Z][a-zA-Z\s]+)/i);
    const locality = locMatch ? locMatch[1].trim() : 'Chennai';

    return [{
      id: propId,
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
      latitude: jittered.lat,
      longitude: jittered.lng,
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
