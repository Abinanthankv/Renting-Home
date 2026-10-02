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

  async fetchUrlContent(targetUrl) {
    for (const proxyFn of this.corsProxies) {
      try {
        const proxyUrl = proxyFn(targetUrl);
        const res = await fetch(proxyUrl, {
          headers: { 'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' }
        });
        if (res.ok) {
          const text = await res.text();
          if (text && text.length > 500) {
            return text;
          }
        }
      } catch (err) {
        console.warn(`Proxy failed for ${targetUrl}:`, err);
      }
    }
    return null; // Return null to trigger smart slug parsing fallback
  }

  async parseUrlOrPayload(urlOrPayload) {
    const isUrl = urlOrPayload.trim().startsWith('http://') || urlOrPayload.trim().startsWith('https://');
    let rawHtml = '';
    let url = isUrl ? urlOrPayload.trim() : '';

    if (isUrl) {
      rawHtml = await this.fetchUrlContent(url);
      if (!rawHtml) {
        // Smart URL slug parsing fallback
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

    if (!bhkCount) bhkCount = 2; // default 2 BHK if nothing given

    if (!sq) {
      switch (bhkCount) {
        case 1: sq = 700; break;
        case 2: sq = 1000; break;
        case 3: sq = 1500; break;
        case 4: default: sq = 2000; break;
      }
    }

    // Dynamic rate calculation based on carpet area (sqft)
    // Local market average rate for South Chennai suburban rentals is ~₹22.85 / sqft
    const rawRent = sq * 22.85;
    const rent = Math.round(rawRent / 500) * 500; // round to nearest ₹500
    const deposit = rent * 3; // standard 3 months deposit

    return {
      bhk: `${bhkCount} BHK`,
      rent: Math.max(8000, rent),
      deposit: Math.max(24000, deposit),
      sqft: sq
    };
  }

  parseFromUrlSlug(url) {
    const isNoBroker = url.includes('nobroker.in');
    const is99acres = url.includes('99acres.com');
    const source = isNoBroker ? 'NoBroker' : (is99acres ? '99acres' : 'Web Link');

    // Extract title from URL slug
    const pathParts = new URL(url).pathname.split('/').filter(Boolean);
    const slug = pathParts.find(p => p.includes('for-rent') || p.includes('bhk') || p.includes('apartment') || p.includes('house')) || pathParts[0] || 'Rental Property';
    
    // Clean title
    let title = slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    title = title.replace(/\bRs\b/gi, '₹').replace(/Spid[ -]?\w+/i, '').trim();

    // Extract BHK
    const bhkMatch = url.match(/(\d+)[ -]?bhk/i) || url.match(/(\d+)[ -]?rk/i);
    const bhkRaw = bhkMatch ? `${bhkMatch[1]} BHK` : null;

    // Extract Sqft
    const sqftMatch = url.match(/(\d+)-?sqft/i) || url.match(/(\d+)-?sq-?ft/i);
    const sqftParsed = sqftMatch ? parseInt(sqftMatch[1], 10) : null;

    // Get smart heuristic defaults for BHK/Rent/Deposit/Sqft
    const metrics = this.getHeuristicMetrics(bhkRaw, sqftParsed);

    // Extract Rent if explicitly present in URL slug (e.g., for-rs-15000 or rs-16000)
    const rentMatch = url.match(/for-rs-?(\d+)/i) || url.match(/rs-?(\d+)/i) || url.match(/rent-?(\d+)/i);
    const rent = rentMatch ? parseInt(rentMatch[1], 10) : metrics.rent;
    const deposit = rentMatch ? rent * 3 : metrics.deposit;
    const bhk = bhkRaw || metrics.bhk;
    const sqft = sqftParsed || metrics.sqft;

    // Detect locality and coordinates
    const lowerUrl = url.toLowerCase();
    let locality = 'Chennai South';
    let lat = 12.9210;
    let lng = 80.1012;

    if (lowerUrl.includes('ssm-nagar') || lowerUrl.includes('ssm_nagar') || lowerUrl.includes('ssm nagar')) {
      locality = 'SSM Nagar, Perungalathur';
      lat = 12.9025;
      lng = 80.0785;
    } else if (lowerUrl.includes('perungalathur')) {
      locality = lowerUrl.includes('old-perungalathur') ? 'Old Perungalathur' : 'New Perungalathur';
      lat = 12.9049;
      lng = 80.0846;
    } else if (lowerUrl.includes('tambaram')) {
      locality = lowerUrl.includes('east-tambaram') ? 'East Tambaram' : 'Tambaram West';
      lat = 12.9249;
      lng = 80.1000;
    } else if (lowerUrl.includes('selaiyur')) {
      locality = 'Selaiyur';
      lat = 12.9226;
      lng = 80.1294;
    } else if (lowerUrl.includes('chrompet')) {
      locality = 'Chromepet';
      lat = 12.9522;
      lng = 80.1410;
    } else if (lowerUrl.includes('guduvancheri') || lowerUrl.includes('guduvancherry')) {
      locality = 'Guduvancheri';
      lat = 12.8439;
      lng = 80.0597;
    } else if (lowerUrl.includes('vandalur')) {
      locality = 'Vandalur';
      lat = 12.8904;
      lng = 80.0815;
    }

    const defaultPhoto = isNoBroker 
      ? 'https://images.nobroker.in/images/8aa9b54ea06c38c201a06c44fbca0698/8aa9b54ea06c38c201a06c44fbca0698_59177_941964_large.jpg'
      : 'https://imagecdn.99acres.com/media1/42388/11/847771685O-1790470546077.jpg';

    return [{
      id: `${isNoBroker ? 'nb' : 'acres'}_${Date.now()}`,
      source,
      title: title || `${bhk} Rental Property in ${locality}`,
      rent,
      deposit,
      maintenance: 1000,
      sqft,
      bhk,
      furnishing: 'Semi-Furnished',
      preferredTenant: 'Family / Working Professionals',
      locality,
      address: `${locality}, Chennai, Tamil Nadu`,
      latitude: lat,
      longitude: lng,
      description: `Property imported from ${source} link. (${url})`,
      photos: [defaultPhoto],
      url,
      createdAt: Date.now()
    }];
  }

  parseNoBroker(html, url) {
    const listings = [];

    // Method 1: Check for nb.appState or JSON payload script tags in HTML
    const appStateMatch = html.match(/nb\.appState\s*=\s*(\{.+?\});?\s*<\/script>/s) ||
                          html.match(/window\.nb\.appState\s*=\s*(\{.+?\});?\s*<\/script>/s) ||
                          html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>(.*?)<\/script>/s);

    if (appStateMatch) {
      try {
        const jsonText = appStateMatch[1] || appStateMatch[0];
        const state = JSON.parse(jsonText);
        
        // Single detail page
        if (state.propertyDetails && state.propertyDetails.detailsData) {
          const item = state.propertyDetails.detailsData;
          listings.push(this.formatNoBrokerItem(item, url));
        }

        // Search list page
        if (state.resultScreenReducer && Array.isArray(state.resultScreenReducer.propertyList)) {
          state.resultScreenReducer.propertyList.forEach(item => {
            listings.push(this.formatNoBrokerItem(item, url));
          });
        }
      } catch (e) {
        console.warn('Failed parsing NoBroker JSON script tag:', e);
      }
    }

    // Method 2: If JSON parsing didn't find items, use URL slug parsing as primary source if URL is present
    if (listings.length === 0 && url && url.includes('nobroker.in')) {
      const slugItems = this.parseFromUrlSlug(url);
      if (slugItems && slugItems.length > 0) {
        const item = slugItems[0];
        
        // Enrich slug item with any additional info extracted from HTML regex
        const htmlTitle = this.extractRegex(html, /<title[^>]*>(.*?)<\/title>/i);
        if (htmlTitle && !htmlTitle.includes('404') && !htmlTitle.includes('Access Denied')) {
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
      const bhkMatch = html.match(/(\d+)\s*bhk/i);
      const bhkStr = bhkMatch ? `${bhkMatch[1]} BHK` : null;
      const sqftParsed = parseInt(this.extractRegex(html, /([0-9,]+)\s*sq/i)?.replace(/,/g, '') || '0', 10);
      const metrics = this.getHeuristicMetrics(bhkStr, sqftParsed);

      const title = this.extractRegex(html, /<title[^>]*>(.*?)<\/title>/i) || `${metrics.bhk} Flat for Rent`;
      const rent = parseInt(this.extractRegex(html, /₹\s*([0-9,]+)/i)?.replace(/,/g, '') || '0', 10) || metrics.rent;
      const deposit = parseInt(this.extractRegex(html, /Deposit[^0-9]*([0-9,]+)/i)?.replace(/,/g, '') || '0', 10) || metrics.deposit;

      const lat = parseFloat(this.extractRegex(html, /"latitude":\s*([0-9.]+)/i) || '12.9210');
      const lng = parseFloat(this.extractRegex(html, /"longitude":\s*([0-9.]+)/i) || '80.1012');

      listings.push({
        id: `nb_${Date.now()}`,
        source: 'NoBroker',
        title: title.replace(/\|?\s*NoBroker.*/i, '').trim(),
        rent,
        deposit,
        maintenance: 1000,
        sqft: sqftParsed || metrics.sqft,
        bhk: bhkStr || metrics.bhk,
        furnishing: 'Semi-Furnished',
        preferredTenant: 'All',
        locality: 'Chennai South',
        address: 'Chennai South, Tamil Nadu',
        latitude: lat,
        longitude: lng,
        description: 'Listing imported from NoBroker.',
        photos: ['https://images.nobroker.in/static/img/fav64.png'],
        url: url || 'https://www.nobroker.in',
        createdAt: Date.now()
      });
    }

    return listings;
  }

  formatNoBrokerItem(item, originalUrl) {
    const lat = parseFloat(item.latitude || item.location?.split(',')[0] || 12.9210);
    const lng = parseFloat(item.longitude || item.location?.split(',')[1] || 80.1012);

    let photos = [];
    if (Array.isArray(item.photos)) {
      photos = item.photos.map(p => {
        if (p.imagesMap && p.imagesMap.large) {
          return p.imagesMap.large.startsWith('http') ? p.imagesMap.large : `https://images.nobroker.in/images/${item.id}/${p.imagesMap.large}`;
        }
        return 'https://images.nobroker.in/static/img/fav64.png';
      }).slice(0, 8);
    }

    return {
      id: `nb_${item.id || Date.now()}`,
      source: 'NoBroker',
      title: item.propertyTitle || item.title || `${item.typeDesc || '1 BHK'} House for Rent in ${item.locality || 'Chennai'}`,
      rent: item.rent || 0,
      deposit: item.deposit || 0,
      maintenance: item.maintenanceAmount || 0,
      sqft: item.propertySize || 600,
      bhk: item.typeDesc || item.type || '1 BHK',
      furnishing: item.furnishingDesc || item.furnishing || 'Unfurnished',
      preferredTenant: Array.isArray(item.leaseTypeNew) ? item.leaseTypeNew.join(', ') : (item.leaseType || 'All'),
      locality: item.locality || item.nbLocality || 'Chennai',
      address: item.address || item.completeStreetName || item.secondaryTitle || 'Chennai',
      latitude: lat,
      longitude: lng,
      description: item.combineDescription || item.description || item.ownerDescription || 'No description provided.',
      photos: photos.length ? photos : ['https://images.nobroker.in/static/img/fav64.png'],
      url: item.detailUrl ? `https://www.nobroker.in${item.detailUrl}` : (originalUrl || 'https://www.nobroker.in'),
      createdAt: Date.now()
    };
  }

  parse99acres(html, url) {
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
        maintenance: 1500,
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
        photos: schemaData.image ? (Array.isArray(schemaData.image) ? schemaData.image : [schemaData.image]) : ['https://static.99acres.com/favicon.png'],
        url: url || 'https://www.99acres.com',
        createdAt: Date.now()
      });
    } else {
      // Method 2: Generic fallback regex extraction
      const title = this.extractRegex(html, /<title[^>]*>(.*?)<\/title>/i) || 'Rental Property in Chennai';
      const bhkMatch = html.match(/(\d+)\s*bhk/i) || (url ? url.match(/(\d+)[ -]?bhk/i) : null);
      const bhkStr = bhkMatch ? `${bhkMatch[1]} BHK` : null;
      const sqftParsed = parseInt(this.extractRegex(html, /([0-9,]+)\s*sq/i)?.replace(/,/g, '') || '0', 10);
      const metrics = this.getHeuristicMetrics(bhkStr, sqftParsed);

      const rent = parseInt(this.extractRegex(html, /₹\s*([0-9,]+)/i)?.replace(/,/g, '') || '0', 10) || metrics.rent;
      const deposit = parseInt(this.extractRegex(html, /([0-9,]+)\s*(?:deposit|security)/i)?.replace(/,/g, '') || '0', 10) || metrics.deposit;

      listings.push({
        id: `acres_${Date.now()}`,
        source: '99acres',
        title: title.replace('99acres.com', '').trim(),
        rent,
        deposit,
        maintenance: 0,
        sqft: sqftParsed || metrics.sqft,
        bhk: bhkStr || metrics.bhk,
        furnishing: 'Semi-Furnished',
        preferredTenant: 'All',
        locality: 'Chennai South',
        address: 'Chennai South, Tamil Nadu',
        latitude: 12.9049,
        longitude: 80.0846,
        description: 'Listing imported from 99acres.',
        photos: ['https://static.99acres.com/favicon.png'],
        url: url || 'https://www.99acres.com',
        createdAt: Date.now()
      });
    }

    return listings;
  }

  parseGeneric(html, url) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const title = doc.querySelector('title')?.innerText || 'Saved Rental Property';
    const rentMatch = html.match(/₹\s*([0-9,]+)/i) || html.match(/rs\.?\s*([0-9,]+)/i);
    const rent = rentMatch ? parseInt(rentMatch[1].replace(/,/g, ''), 10) : 15000;

    return [{
      id: `prop_${Date.now()}`,
      source: 'Custom Import',
      title: title.trim(),
      rent,
      deposit: rent * 5,
      maintenance: 0,
      sqft: 750,
      bhk: '2 BHK',
      furnishing: 'Unfurnished',
      preferredTenant: 'All',
      locality: 'Chennai',
      address: 'Chennai, Tamil Nadu',
      latitude: 12.9200,
      longitude: 80.1000,
      description: doc.body.innerText.slice(0, 400) + '...',
      photos: ['https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=600&auto=format&fit=crop'],
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
