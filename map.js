/**
 * Leaflet map controller & Overpass / DataMeet Nearby Transit Radar
 */
class MapController {
  constructor() {
    this.map = null;
    this.markersGroup = null;
    this.nearbyGroup = null;
    this.radiusCircle = null;
    this.selectedProperty = null;
    this.tileLayers = {};
    // High-precision coordinates for Chennai Suburban Railway corridor stations
    this.precisionStationCoords = {
      'TBM': { lat: 12.924900, lng: 80.116800 },
      'PRGL': { lat: 12.905400, lng: 80.091000 },
      'TBMS': { lat: 12.937200, lng: 80.126500 },
      'CMP': { lat: 12.951600, lng: 80.141100 },
      'PV': { lat: 12.967574, lng: 80.152050 },
      'TLM': { lat: 12.980461, lng: 80.165793 },
      'MN': { lat: 12.987700, lng: 80.176200 },
      'PZA': { lat: 12.990638, lng: 80.187940 },
      'STM': { lat: 12.994639, lng: 80.200193 },
      'GDY': { lat: 13.008047, lng: 80.213136 },
      'SP': { lat: 13.023310, lng: 80.223719 },
      'MBM': { lat: 13.038066, lng: 80.227775 },
      'MKK': { lat: 13.051662, lng: 80.230689 },
      'MSC': { lat: 13.074342, lng: 80.242421 },
      'MS': { lat: 13.077749, lng: 80.261257 },
      'VDR': { lat: 12.887200, lng: 80.079200 },
      'UPM': { lat: 12.868100, lng: 80.075600 },
      'GI': { lat: 12.846500, lng: 80.062000 }
    };

    // Zero hardcoded amenities - all amenities fetched dynamically at runtime
    this.knownHubs = [];
  }

  async loadDataMeetRailwaysDataset() {
    if (this.railwayStationsData) return this.railwayStationsData;

    try {
      // Check local cache first
      const cached = localStorage.getItem('datameet_railways_cache');
      if (cached) {
        this.railwayStationsData = JSON.parse(cached);
        console.log(`[RentRadar] Loaded ${this.railwayStationsData.length} Indian Railway stations from local cache.`);
        return this.railwayStationsData;
      }

      console.log('[RentRadar] Pre-fetching DataMeet Indian Railways station dataset...');
      const res = await fetch('https://raw.githubusercontent.com/datameet/railways/master/stations.json');
      if (res.ok) {
        const geojson = await res.json();
        if (geojson && Array.isArray(geojson.features)) {
          this.railwayStationsData = geojson.features
            .filter(f => f && f.geometry && Array.isArray(f.geometry.coordinates))
            .map(f => {
              const code = f.properties.code || '';
              // Use precision coordinates override if available for suburban line
              const precision = this.precisionStationCoords[code];
              const lat = precision ? precision.lat : f.geometry.coordinates[1];
              const lng = precision ? precision.lng : f.geometry.coordinates[0];

              return {
                name: `${f.properties.name || f.properties.code || 'Station'} (${code || 'IR'})`,
                code,
                type: 'train',
                lat,
                lng
              };
            })
            .filter(s => s.lat && s.lng);

          // Save to LocalStorage cache
          try {
            localStorage.setItem('datameet_railways_cache', JSON.stringify(this.railwayStationsData));
          } catch (e) {
            console.warn('[RentRadar] LocalStorage quota reached, holding stations in memory cache.');
          }

          console.log(`[RentRadar] Successfully loaded ${this.railwayStationsData.length} Indian Railway stations.`);
          return this.railwayStationsData;
        }
      }
    } catch (e) {
      console.warn('[RentRadar] DataMeet dataset offline, using built-in transit hubs fallback.', e);
    }
    return null;
  }

  init(containerId = 'map') {
    if (this.map) return;
    const container = document.getElementById(containerId);
    if (!container) return;

    // Fallback dynamic Leaflet script injector if Leaflet is not yet loaded
    if (typeof L === 'undefined') {
      console.warn('Leaflet JS not found, attempting dynamic CDN script injection...');
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js';
      script.onload = () => this.init(containerId);
      document.head.appendChild(script);
      return;
    }

    try {
      // Pre-fetch DataMeet railway station dataset in background
      this.loadDataMeetRailwaysDataset();

      // Default center: Tambaram / Perungalathur
      this.map = L.map(containerId, {
        center: [12.9180, 80.0950],
        zoom: 13,
        zoomControl: false
      });

      // 1. Primary Tile Layer: Esri Canvas Dark Gray (Base + Labels) - 100% Free, NO API Keys, NO Watermarks!
      const darkBase = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 16,
        attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ'
      });
      const darkLabels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 16,
        attribution: ''
      });
      const esriDarkGroup = L.layerGroup([darkBase, darkLabels]);

      // 2. Esri World Street Map Layer
      const esriStreetLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, DeLorme, NAVTEQ, USGS'
      });

      // 3. Esri World Satellite Imagery Layer
      const esriSatelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS'
      });

      // 4. Esri World Topo Map Layer
      const esriTopoLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19,
        attribution: 'Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ, TomTom'
      });

      // Add default Street View layer
      esriStreetLayer.addTo(this.map);

      // Layer Control Switcher (top right)
      const baseMaps = {
        "🗺️ Street View": esriStreetLayer,
        "🌙 Dark Mode": esriDarkGroup,
        "🛰️ Satellite": esriSatelliteLayer,
        "⛰️ Topo Map": esriTopoLayer
      };
      L.control.layers(baseMaps, null, { position: 'topright' }).addTo(this.map);

      // Tile error automatic fallback switch
      let fallbackTriggered = false;
      esriStreetLayer.on('tileerror', () => {
        if (!fallbackTriggered) {
          fallbackTriggered = true;
          console.warn('Street tile error, switching to Esri Dark layer fallback...');
          this.map.removeLayer(esriStreetLayer);
          esriDarkGroup.addTo(this.map);
        }
      });

      // Zoom control on top right below layer switcher
      L.control.zoom({ position: 'topright' }).addTo(this.map);

      this.markersGroup = L.layerGroup().addTo(this.map);
      this.nearbyGroup = L.layerGroup().addTo(this.map);
      this.trainRouteGroup = L.layerGroup().addTo(this.map);
      this.renderTrainRouteLine();

      // Force recalculate dimensions at intervals to guarantee 100% container fill
      [50, 200, 500, 1000].forEach(delay => {
        setTimeout(() => {
          if (this.map) this.map.invalidateSize();
        }, delay);
      });

      // Handle window resize
      window.addEventListener('resize', () => {
        if (this.map) this.map.invalidateSize();
      });

    } catch (e) {
      console.error('Error initializing map:', e);
    }
  }

  renderProperties(properties, onSelectProperty) {
    if (!this.map) this.init();
    if (!this.markersGroup) return;

    this.markersGroup.clearLayers();

    if (!properties || properties.length === 0) return;

    const bounds = [];
    const seenCoords = new Map();

    properties.forEach((prop) => {
      if (!prop.latitude || !prop.longitude) return;

      let key = `${prop.latitude.toFixed(5)},${prop.longitude.toFixed(5)}`;
      let finalLat = prop.latitude;
      let finalLng = prop.longitude;

      if (seenCoords.has(key)) {
        const count = seenCoords.get(key) + 1;
        seenCoords.set(key, count);
        const angle = count * 1.25;
        const distance = 0.0008 * Math.sqrt(count);
        finalLat = parseFloat((prop.latitude + (distance * Math.sin(angle))).toFixed(6));
        finalLng = parseFloat((prop.longitude + (distance * Math.cos(angle))).toFixed(6));
      } else {
        seenCoords.set(key, 0);
      }

      const latLng = [finalLat, finalLng];
      bounds.push(latLng);

      const isNoBroker = prop.source === 'NoBroker';
      const badgeColor = isNoBroker ? '#ef4444' : '#3b82f6';
      const formattedPrice = prop.rent >= 1000 ? `₹${(prop.rent / 1000).toFixed(1)}k` : `₹${prop.rent}`;

      // Custom HTML Marker Badge
      const customIcon = L.divIcon({
        className: 'custom-map-pin',
        html: `
          <div class="map-price-badge" style="background-color: ${badgeColor}; border: 2px solid white;">
            <span>${formattedPrice}</span>
          </div>
        `,
        iconSize: [54, 28],
        iconAnchor: [27, 28]
      });

      const marker = L.marker(latLng, { icon: customIcon });

      const popupContent = `
        <div class="map-popup-card">
          <img src="${prop.photos && prop.photos[0] ? prop.photos[0] : ''}" alt="property photo" class="map-popup-img" />
          <div class="map-popup-body">
            <span class="map-popup-badge" style="background: ${badgeColor}">${prop.source}</span>
            <h4 class="map-popup-title">${prop.title}</h4>
            <div class="map-popup-price">₹${prop.rent.toLocaleString()}/mo <span style="font-size:11px;color:#94a3b8;">(Dep: ₹${prop.deposit.toLocaleString()})</span></div>
            <p class="map-popup-address" onclick="window.open('https://www.google.com/maps/search/?api=1&query=${prop.latitude},${prop.longitude}', '_blank')" title="Open location in Google Maps">
              <i data-lucide="map-pin" style="color:#6366f1;"></i> ${prop.locality || prop.address} <span style="font-size:10px; color:#6366f1; font-weight:bold;">↗</span>
            </p>
            <button class="map-popup-btn" onclick="window.app.selectProperty('${prop.id}')">View Details & Nearby</button>
          </div>
        </div>
      `;

      marker.bindPopup(popupContent, { maxWidth: 260 });
      marker.on('click', () => {
        if (onSelectProperty) onSelectProperty(prop);
      });

      this.markersGroup.addLayer(marker);
    });

    if (bounds.length > 0) {
      this.map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
    }

    setTimeout(() => {
      if (this.map) this.map.invalidateSize();
    }, 100);

    // Automatically load & display nearby amenities (railways, theaters, petrol bunks, schools) on map load
    this.loadAllAreaAmenities(properties);
  }

  async loadAllAreaAmenities(properties) {
    if (!properties || properties.length === 0) return;
    const mainProp = properties[0];
    if (mainProp && mainProp.latitude && mainProp.longitude) {
      await this.fetchNearbyAmenities(mainProp.latitude, mainProp.longitude);
    }
  }

  async highlightProperty(prop) {
    if (!this.map || !prop || !prop.latitude || !prop.longitude) return;

    this.selectedProperty = prop;
    const center = [prop.latitude, prop.longitude];

    this.map.invalidateSize();
    this.map.flyTo(center, 15, { duration: 1.2 });

    // Draw radius circle (1.5 km)
    if (this.radiusCircle) {
      this.map.removeLayer(this.radiusCircle);
    }

    this.radiusCircle = L.circle(center, {
      color: '#6366f1',
      fillColor: '#818cf8',
      fillOpacity: 0.15,
      radius: 1500 // 1.5 km
    }).addTo(this.map);

    // Fetch and display nearby transport points & live Overpass amenities
    await this.findNearbyTransitAndAmenities(prop.latitude, prop.longitude);
  }

  async findNearbyTransitAndAmenities(lat, lng) {
    if (!this.nearbyGroup) return;
    this.nearbyGroup.clearLayers();
    const nearbyResults = [];

    // 1. Calculate distance to preloaded local transit hubs & amenities (bus, metro, hospitals, schools)
    this.knownHubs.forEach(hub => {
      const distKm = this.calculateDistance(lat, lng, hub.lat, hub.lng);
      if (distKm <= 15.0) {
        nearbyResults.push({
          ...hub,
          distanceKm: parseFloat(distKm.toFixed(2)),
          walkTimeMin: Math.round(distKm * 12)
        });
      }
    });

    // 2. Process DataMeet Indian Railways dataset for nearest train stations (0ms delay)
    const stations = await this.loadDataMeetRailwaysDataset();
    if (stations && Array.isArray(stations)) {
      stations.forEach(stn => {
        const distKm = this.calculateDistance(lat, lng, stn.lat, stn.lng);
        if (distKm <= 15.0) {
          const isDuplicate = nearbyResults.some(r => r.name.toLowerCase().trim() === stn.name.toLowerCase().trim());
          if (!isDuplicate) {
            nearbyResults.push({
              name: stn.name,
              code: stn.code,
              type: 'train',
              lat: stn.lat,
              lng: stn.lng,
              distanceKm: parseFloat(distKm.toFixed(2)),
              walkTimeMin: Math.round(distKm * 12)
            });
          }
        }
      });
    }

    // Sort by distance ascending & render initial list immediately (0ms delay)
    nearbyResults.sort((a, b) => a.distanceKm - b.distanceKm);
    this.renderNearbyMarkers(nearbyResults);
    this.updateNearbyDOMList(nearbyResults);

    // 3. Check LocalStorage Cache for Overpass Amenities (Drastically reduces network calls!)
    const cacheKey = `overpass_amenities_${lat.toFixed(3)}_${lng.toFixed(3)}`;
    try {
      const cachedAmenities = localStorage.getItem(cacheKey);
      if (cachedAmenities) {
        const parsed = JSON.parse(cachedAmenities);
        if (Array.isArray(parsed) && parsed.length > 0) {
          console.log(`[RentRadar] Loaded ${parsed.length} nearby amenities from local cache for (${lat.toFixed(3)}, ${lng.toFixed(3)})`);
          parsed.forEach(item => {
            const isDuplicate = nearbyResults.some(r => r.name.toLowerCase().trim() === item.name.toLowerCase().trim());
            if (!isDuplicate) {
              nearbyResults.push(item);
            }
          });

          nearbyResults.sort((a, b) => a.distanceKm - b.distanceKm);
          this.renderNearbyMarkers(nearbyResults);
          this.updateNearbyDOMList(nearbyResults);
          return; // Skip network call completely!
        }
      }
    } catch (e) {
      console.warn('[RentRadar] LocalStorage cache read failed:', e);
    }

    // 4. Dynamically Query OpenStreetMap Overpass API Mirrors if not cached
    const overpassQuery = `[out:json][timeout:10];
      (
        node["amenity"="cinema"](around:5000,${lat},${lng});
        node["amenity"="fuel"](around:3500,${lat},${lng});
        node["amenity"="hospital"](around:3500,${lat},${lng});
        node["amenity"="school"](around:3000,${lat},${lng});
        node["highway"="bus_stop"](around:2500,${lat},${lng});
        node["amenity"="college"](around:4000,${lat},${lng});
        node["amenity"="pharmacy"](around:2500,${lat},${lng});
      );
      out body 35;`;

    const mirrors = [
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
      'https://overpass-api.de/api/interpreter',
      'https://overpass.kumi.systems/api/interpreter'
    ];

    for (const mirror of mirrors) {
      try {
        const res = await fetch(`${mirror}?data=${encodeURIComponent(overpassQuery)}`);
        if (res.ok) {
          const data = await res.json();
          if (data && Array.isArray(data.elements)) {
            const fetchedAmenities = [];

            data.elements.forEach(el => {
              const rawName = el.tags ? (el.tags.name || el.tags['name:en']) : null;
              if (rawName && rawName.trim().length > 2) {
                const elLat = el.lat;
                const elLng = el.lon;
                const distKm = this.calculateDistance(lat, lng, elLat, elLng);

                let amenityType = 'hospital';
                if (el.tags.highway === 'bus_stop') amenityType = 'bus';
                else if (el.tags.amenity === 'cinema' || el.tags.building === 'cinema') amenityType = 'cinema';
                else if (el.tags.amenity === 'fuel') amenityType = 'fuel';
                else if (el.tags.amenity === 'school' || el.tags.amenity === 'college') amenityType = 'school';
                else if (el.tags.amenity === 'hospital' || el.tags.amenity === 'pharmacy') amenityType = 'hospital';

                const amenityObj = {
                  name: rawName,
                  type: amenityType,
                  lat: elLat,
                  lng: elLng,
                  distanceKm: parseFloat(distKm.toFixed(2)),
                  walkTimeMin: Math.round(distKm * 12)
                };

                fetchedAmenities.push(amenityObj);

                const isDuplicate = nearbyResults.some(r =>
                  r.name.toLowerCase().trim() === rawName.toLowerCase().trim()
                );

                if (!isDuplicate) {
                  nearbyResults.push(amenityObj);
                }
              }
            });

            // Cache fetched amenities to LocalStorage for zero-network future lookups!
            try {
              localStorage.setItem(cacheKey, JSON.stringify(fetchedAmenities));
              console.log(`[RentRadar] Cached ${fetchedAmenities.length} amenities to LocalStorage (${cacheKey})`);
            } catch (e) {
              console.warn('[RentRadar] LocalStorage save quota exceeded:', e);
            }

            // Re-sort all items (railways + dynamic amenities) by distance
            nearbyResults.sort((a, b) => a.distanceKm - b.distanceKm);

            // Update Leaflet map markers and drawer list dynamically
            this.renderNearbyMarkers(nearbyResults);
            this.updateNearbyDOMList(nearbyResults);
            break; // Stop after first successful mirror
          }
        }
      } catch (e) {
        // Try next mirror
      }
    }
  }

  renderNearbyMarkers(nearbyResults) {
    if (!this.nearbyGroup) return;
    this.nearbyGroup.clearLayers();
    nearbyResults.slice(0, 25).forEach(place => {
      let iconSymbol = '🚆';
      let bgColor = '#3b82f6';
      if (place.type === 'bus') { iconSymbol = '🚌'; bgColor = '#f59e0b'; }
      if (place.type === 'metro') { iconSymbol = '🚇'; bgColor = '#8b5cf6'; }
      if (place.type === 'cinema') { iconSymbol = '🎬'; bgColor = '#ec4899'; }
      if (place.type === 'fuel') { iconSymbol = '⛽'; bgColor = '#06b6d4'; }
      if (place.type === 'hospital') { iconSymbol = '🏥'; bgColor = '#ef4444'; }
      if (place.type === 'school') { iconSymbol = '🏫'; bgColor = '#10b981'; }

      const placeIcon = L.divIcon({
        className: 'nearby-map-pin',
        html: `<div style="background: ${bgColor}; width: 26px; height: 26px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 14px; border: 2px solid white; box-shadow: 0 2px 5px rgba(0,0,0,0.3);">${iconSymbol}</div>`,
        iconSize: [26, 26],
        iconAnchor: [13, 13]
      });

      const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${place.lat},${place.lng}`;

      const marker = L.marker([place.lat, place.lng], { icon: placeIcon });
      marker.bindPopup(`
        <div style="font-family: sans-serif; padding: 4px;">
          <strong style="font-size: 13px;">${iconSymbol} ${place.name}</strong><br/>
          <span style="color: #38bdf8; font-size: 11px; font-family: monospace;">📍 ${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}</span><br/>
          <span style="color: #64748b; font-size: 12px;">Distance: <strong>${place.distanceKm} km</strong> (~${place.walkTimeMin} mins walk)</span><br/>
          <a href="${gmapsUrl}" target="_blank" rel="noopener" style="display:inline-block; margin-top:6px; color:#6366f1; font-weight:bold; font-size:11px; text-decoration:none;">Open in Google Maps &rarr;</a>
        </div>
      `);
      this.nearbyGroup.addLayer(marker);
    });
  }

  updateNearbyDOMList(places) {
    const container = document.getElementById('nearbyRadarList');
    if (!container) return;

    if (!places || places.length === 0) {
      container.innerHTML = `<div class="empty-nearby">No major transit points detected within 15 km radius.</div>`;
      return;
    }

    // Display all available nearby stations (up to 25) with Lat/Lng and Google Maps tap handler
    container.innerHTML = places.slice(0, 25).map(p => {
      let icon = 'train-front';
      let badgeClass = 'badge-blue';
      if (p.type === 'bus') { icon = 'bus'; badgeClass = 'badge-amber'; }
      if (p.type === 'cinema') { icon = 'clapperboard'; badgeClass = 'badge-pink'; }
      if (p.type === 'fuel') { icon = 'fuel'; badgeClass = 'badge-cyan'; }
      if (p.type === 'hospital') { icon = 'activity'; badgeClass = 'badge-rose'; }
      if (p.type === 'school') { icon = 'graduation-cap'; badgeClass = 'badge-emerald'; }

      const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;

      return `
        <div class="nearby-item clickable-nearby" onclick="window.open('${gmapsUrl}', '_blank')" title="Click to open location in Google Maps">
          <div class="nearby-item-icon ${badgeClass}">
            <i data-lucide="${icon}"></i>
          </div>
          <div class="nearby-item-info">
            <div class="nearby-item-name">${p.name}</div>
            <div class="nearby-item-coords">📍 ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}</div>
            <div class="nearby-item-dist">${p.distanceKm} km away • ~${p.walkTimeMin} min walk</div>
          </div>
          <a href="${gmapsUrl}" target="_blank" rel="noopener" class="gmaps-link-btn" onclick="event.stopPropagation();" title="Open in Google Maps">
            <i data-lucide="external-link"></i>
          </a>
        </div>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
  }

  renderTrainRouteLine() {
    if (!this.map || !this.trainRouteGroup) return;

    const trainCorridorPoints = [
      [12.6931, 79.9772], // Chengalpattu (CGL)
      [12.7302, 79.9926], // Paranur (PRUN)
      [12.7631, 80.0076], // Singaperumal Koil (SKL)
      [12.7938, 80.0245], // Maraimalai Nagar (MMNK)
      [12.8225, 80.0435], // Kattangulattur (CTM)
      [12.8315, 80.0498], // Potheri (POTI)
      [12.8465, 80.0620], // Guduvancheri (GI)
      [12.8681, 80.0756], // Urapakkam (UPM)
      [12.8872, 80.0792], // Vandalur (VDR)
      [12.9054, 80.0910], // Perungalathur (PRGL)
      [12.9249, 80.1168], // Tambaram (TBM)
      [12.9372, 80.1265], // Tambaram Sanatorium (TBMS)
      [12.9516, 80.1411], // Chromepet (CMP)
      [12.9676, 80.1521], // Pallavaram (PV)
      [12.9805, 80.1658], // Tirusulam (TLM)
      [12.9877, 80.1762], // Minambakkam (MN)
      [12.9906, 80.1879], // Palavanthangal (PZA)
      [12.9946, 80.2002], // St. Thomas Mount (STM)
      [13.0080, 80.2131], // Guindy (GDY)
      [13.0233, 80.2237], // Saidapet (SP)
      [13.0381, 80.2278], // Mambalam (MBM)
      [13.0517, 80.2307], // Kodambakkam (MKK)
      [13.0743, 80.2424], // Chetpet (MSC)
      [13.0777, 80.2613], // Chennai Egmore (MS)
      [13.0808, 80.2731], // Chennai Park (MPK)
      [13.0824, 80.2760], // Chennai Central (MAS)
      [13.0903, 80.2905]  // Chennai Beach (MSB)
    ];

    // Glow line (background)
    L.polyline(trainCorridorPoints, {
      color: '#38bdf8',
      weight: 6,
      opacity: 0.35
    }).addTo(this.trainRouteGroup);

    // Railway track line (dashed railway line overlay)
    L.polyline(trainCorridorPoints, {
      color: '#6366f1',
      weight: 3,
      opacity: 0.95,
      dashArray: '8, 8'
    }).addTo(this.trainRouteGroup);
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}

window.mapController = new MapController();

