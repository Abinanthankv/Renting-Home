/**
 * Main App Controller
 */
class AppController {
  constructor() {
    this.allProperties = [];
    this.filteredProperties = [];
    this.selectedProperty = null;
    this.currentFilter = 'all';
    this.searchQuery = '';
    this.currentPhotoIndex = 0;
    this.deferredPwaPrompt = null;
    this.currentView = 'list';
    this.weights = { rent: 40, space: 30, transit: 20, deposit: 10 };
    this.selectedForComparison = new Set();
  }

  async init() {
    // 1. Initialize Map
    if (window.mapController) {
      window.mapController.init('map');
    }

    // 2. Setup Event Listeners
    this.setupEventListeners();

    // 3. Initialize DB & Load Properties
    try {
      await window.propertyDB.init();
      
      // Clean up legacy demo listing IDs if present
      const demoIds = ['nb_8aa9b54ea06c38c201a06c44fbca0698', 'acres_T91369142', 'nb_8a9fbf8283548f36018354fb4c394cd7'];
      for (const demoId of demoIds) {
        await window.propertyDB.delete(demoId);
      }

      this.allProperties = await window.propertyDB.getAll();
    } catch (e) {
      console.warn('DB load error:', e);
    }

    // 4. Render Sidebar Feed & Map Markers
    this.applyFiltersAndRender();

    // 5. Register PWA (only on http/https protocols)
    if (location.protocol.startsWith('http')) {
      this.registerPWA();
    }

    // Lucide icons
    if (window.lucide) window.lucide.createIcons();
  }

  registerPWA() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js')
        .then(() => console.log('PWA Service Worker registered.'))
        .catch((err) => console.warn('PWA SW registration failed:', err));
    }

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferredPwaPrompt = e;
      const installBtn = document.getElementById('installPwaBtn');
      if (installBtn) installBtn.style.display = 'inline-flex';
    });
  }



  setupEventListeners() {
    // Search input listener
    const searchInput = document.getElementById('searchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.toLowerCase();
        this.applyFiltersAndRender();
      });
    }

    // Filter pills listener
    const filterPills = document.getElementById('filterPills');
    if (filterPills) {
      filterPills.addEventListener('click', (e) => {
        if (e.target.classList.contains('pill')) {
          filterPills.querySelectorAll('.pill').forEach(p => p.classList.remove('active'));
          e.target.classList.add('active');
          this.currentFilter = e.target.getAttribute('data-filter');
          this.applyFiltersAndRender();
        }
      });
    }

    // Modal triggers
    document.getElementById('openImportModalBtn')?.addEventListener('click', () => this.openImportModal());
    document.getElementById('closeImportModalBtn')?.addEventListener('click', () => this.closeImportModal());
    document.getElementById('cancelImportBtn')?.addEventListener('click', () => this.closeImportModal());
    document.getElementById('closeDrawerBtn')?.addEventListener('click', () => this.closeDrawer());

    // Modal Tabs
    document.getElementById('tabUrlBtn')?.addEventListener('click', (e) => this.switchModalTab('url', e.target));
    document.getElementById('tabPasteBtn')?.addEventListener('click', (e) => this.switchModalTab('paste', e.target));
    document.getElementById('tabManualBtn')?.addEventListener('click', (e) => this.switchModalTab('manual', e.target));
    document.getElementById('tabPresetsBtn')?.addEventListener('click', (e) => this.switchModalTab('presets', e.target));

    // Scrape button
    document.getElementById('startScrapeBtn')?.addEventListener('click', () => this.handleScrapeSubmit());

    // Preset buttons inside modal
    document.getElementById('presetNoBroker1Bhk')?.addEventListener('click', () => this.loadPreset('nb1'));
    document.getElementById('preset99acres4Bhk')?.addEventListener('click', () => this.loadPreset('acres4'));
    document.getElementById('presetSathyaFlat')?.addEventListener('click', () => this.loadPreset('sathya1'));

    // Export / Import
    document.getElementById('exportDataBtn')?.addEventListener('click', () => window.propertyDB.exportJSON());
    document.getElementById('importDataBtn')?.addEventListener('click', () => document.getElementById('importFileInput')?.click());
    document.getElementById('importFileInput')?.addEventListener('change', (e) => this.handleFileImport(e));

    // Install PWA button
    document.getElementById('installPwaBtn')?.addEventListener('click', () => {
      if (this.deferredPwaPrompt) {
        this.deferredPwaPrompt.prompt();
        this.deferredPwaPrompt.userChoice.then(() => {
          this.deferredPwaPrompt = null;
          document.getElementById('installPwaBtn').style.display = 'none';
        });
      }
    });
  }

  applyFiltersAndRender() {
    this.filteredProperties = this.allProperties.filter(prop => {
      // Source / Category filter
      if (this.currentFilter === 'NoBroker' && prop.source !== 'NoBroker') return false;
      if (this.currentFilter === '99acres' && prop.source !== '99acres') return false;
      if (this.currentFilter === 'under15k' && prop.rent >= 15000) return false;
      if (this.currentFilter === '1bhk' && !prop.bhk.includes('1')) return false;
      if (this.currentFilter === '2bhk+' && (prop.bhk.includes('1') || prop.bhk.includes('RK'))) return false;

      // Text search
      if (this.searchQuery) {
        const fullStr = `${prop.title} ${prop.locality} ${prop.address} ${prop.bhk}`.toLowerCase();
        if (!fullStr.includes(this.searchQuery)) return false;
      }

      return true;
    });

    this.renderSidebarFeed();
    window.mapController.renderProperties(this.filteredProperties, (prop) => this.selectProperty(prop.id));
  }

  renderSidebarFeed() {
    const feed = document.getElementById('listingsFeed');
    if (!feed) return;

    if (this.filteredProperties.length === 0) {
      feed.innerHTML = `
        <div class="empty-state">
          <i data-lucide="building"></i>
          <p>No listings match your filters.</p>
          <button class="btn btn-secondary" onclick="window.app.openImportModal()">+ Add New Listing</button>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    feed.innerHTML = this.filteredProperties.map(prop => {
      const isSelected = this.selectedProperty && this.selectedProperty.id === prop.id;
      const sourceClass = prop.source === 'NoBroker' ? 'source-nobroker' : (prop.source === '99acres' ? 'source-99acres' : 'source-custom');
      const thumb = prop.photos && prop.photos.length ? prop.photos[0] : 'https://cdn-icons-png.flaticon.com/512/609/609803.png';

      return `
        <div class="property-card ${isSelected ? 'selected' : ''}" onclick="window.app.selectProperty('${prop.id}')">
          <div class="card-img-wrap">
            <img src="${thumb}" alt="property" onerror="this.src='https://cdn-icons-png.flaticon.com/512/609/609803.png';" />
            <span class="card-source-badge ${sourceClass}">${prop.source}</span>
            <span class="card-price-badge">₹${prop.rent.toLocaleString()}/mo</span>
          </div>
          <div class="card-body">
            <h3 class="card-title">${prop.title}</h3>
            <div class="card-address" onclick="event.stopPropagation(); window.open('https://www.google.com/maps/search/?api=1&query=${prop.latitude},${prop.longitude}', '_blank')" title="Open location in Google Maps">
              <i data-lucide="map-pin"></i> ${prop.locality || prop.address} <span class="gmaps-arrow">↗</span>
            </div>
            <div class="card-specs">
              <span class="spec-item"><i data-lucide="home"></i> ${prop.bhk}</span>
              <span class="spec-item"><i data-lucide="maximize"></i> ${prop.sqft} sqft</span>
              <span class="spec-item"><i data-lucide="shield"></i> Dep: ₹${(prop.deposit/1000).toFixed(0)}k</span>
            </div>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
  }

  async selectProperty(id) {
    const prop = this.allProperties.find(p => p.id === id);
    if (!prop) return;

    this.selectedProperty = prop;
    this.currentPhotoIndex = 0;

    // Highlight card in feed
    this.renderSidebarFeed();

    // 1. Open detail drawer first to instantiate DOM nodes
    this.openDrawer(prop);

    // 2. Map fly to coordinates & calculate nearby radar
    await window.mapController.highlightProperty(prop);
  }

  openDrawer(prop) {
    const drawer = document.getElementById('detailDrawer');
    const content = document.getElementById('drawerContent');
    const sourceBadge = document.getElementById('drawerSourceBadge');
    
    if (!drawer || !content) return;

    sourceBadge.innerText = prop.source;
    sourceBadge.className = `card-source-badge ${prop.source === 'NoBroker' ? 'source-nobroker' : 'source-99acres'}`;

    const mainPhoto = prop.photos && prop.photos.length ? prop.photos[0] : '';

    content.innerHTML = `
      <div class="gallery-container">
        <img id="drawerGalleryImg" src="${mainPhoto}" alt="property photo" />
        ${prop.photos.length > 1 ? `
          <div class="gallery-nav">
            <button onclick="window.app.prevPhoto()" style="background:none;border:none;color:white;cursor:pointer;">&larr;</button>
            <span id="galleryCounter">1 / ${prop.photos.length}</span>
            <button onclick="window.app.nextPhoto()" style="background:none;border:none;color:white;cursor:pointer;">&rarr;</button>
          </div>
        ` : ''}
      </div>

      <h2 class="detail-title">${prop.title}</h2>

      <div class="detail-price-box">
        <div>
          <div class="price-item-val">₹${prop.rent.toLocaleString()}</div>
          <div class="price-item-lbl">Rent / Mo</div>
        </div>
        <div>
          <div class="price-item-val">₹${prop.deposit.toLocaleString()}</div>
          <div class="price-item-lbl">Deposit</div>
        </div>
        <div>
          <div class="price-item-val">₹${(prop.maintenance || 0).toLocaleString()}</div>
          <div class="price-item-lbl">Maintenance</div>
        </div>
      </div>

      <div class="specs-grid">
        <div class="spec-box">
          <i data-lucide="home"></i>
          <div>
            <div class="spec-box-title">BHK Type</div>
            <div class="spec-box-val">${prop.bhk}</div>
          </div>
        </div>
        <div class="spec-box">
          <i data-lucide="maximize"></i>
          <div>
            <div class="spec-box-title">Builtup Area</div>
            <div class="spec-box-val">${prop.sqft} sqft</div>
          </div>
        </div>
        <div class="spec-box">
          <i data-lucide="armchair"></i>
          <div>
            <div class="spec-box-title">Furnishing</div>
            <div class="spec-box-val">${prop.furnishing}</div>
          </div>
        </div>
        <div class="spec-box">
          <i data-lucide="users"></i>
          <div>
            <div class="spec-box-title">Tenants</div>
            <div class="spec-box-val">${prop.preferredTenant}</div>
          </div>
        </div>
      </div>

      <div class="detail-location-clickable" onclick="window.open('https://www.google.com/maps/search/?api=1&query=${prop.latitude},${prop.longitude}', '_blank')" title="Open location in Google Maps">
        <i data-lucide="map-pin" style="color:var(--primary);flex-shrink:0;"></i>
        <span style="flex:1;">${prop.address} <span style="font-size:0.75rem; color:var(--primary); font-weight:600; font-family:monospace; margin-left:4px;">(📍 ${prop.latitude.toFixed(4)}, ${prop.longitude.toFixed(4)}) ↗</span></span>
      </div>

      <!-- Nearby Transport Radar Section -->
      <div class="radar-section">
        <div class="radar-header">
          <i data-lucide="navigation"></i>
          <span>Nearby Transit & Amenity Radar</span>
        </div>
        <div class="nearby-list" id="nearbyRadarList">
          <div style="font-size:0.8rem; color:var(--text-dim);">Scanning OpenStreetMap for nearby stations & stops...</div>
        </div>
      </div>

      <div style="background-color:var(--bg-card); padding:14px; border-radius:var(--radius-md); border:1px solid var(--border-color);">
        <h4 style="font-size:0.85rem; font-weight:700; margin-bottom:6px;">Description / Highlights</h4>
        <p style="font-size:0.8rem; color:var(--text-muted); line-height:1.5;">${prop.description}</p>
      </div>

      <div style="display:flex; gap:10px; margin-top:10px;">
        <a href="${prop.url}" target="_blank" rel="noopener" class="btn btn-primary" style="flex:1; justify-content:center; text-decoration:none;">
          <i data-lucide="external-link"></i> Open Original Listing
        </a>
        <button class="btn btn-secondary" onclick="window.app.deleteCurrentProperty()" style="color:var(--accent-rose);">
          <i data-lucide="trash-2"></i>
        </button>
      </div>
    `;

    drawer.classList.add('open');
    if (window.lucide) window.lucide.createIcons();
  }

  closeDrawer() {
    document.getElementById('detailDrawer')?.classList.remove('open');
    this.selectedProperty = null;
    this.renderSidebarFeed();
  }

  prevPhoto() {
    if (!this.selectedProperty || !this.selectedProperty.photos.length) return;
    this.currentPhotoIndex = (this.currentPhotoIndex - 1 + this.selectedProperty.photos.length) % this.selectedProperty.photos.length;
    this.updatePhotoDisplay();
  }

  nextPhoto() {
    if (!this.selectedProperty || !this.selectedProperty.photos.length) return;
    this.currentPhotoIndex = (this.currentPhotoIndex + 1) % this.selectedProperty.photos.length;
    this.updatePhotoDisplay();
  }

  updatePhotoDisplay() {
    const img = document.getElementById('drawerGalleryImg');
    const counter = document.getElementById('galleryCounter');
    if (img && this.selectedProperty.photos[this.currentPhotoIndex]) {
      img.src = this.selectedProperty.photos[this.currentPhotoIndex];
    }
    if (counter) {
      counter.innerText = `${this.currentPhotoIndex + 1} / ${this.selectedProperty.photos.length}`;
    }
  }

  async deleteCurrentProperty() {
    if (!this.selectedProperty) return;
    if (confirm(`Delete listing "${this.selectedProperty.title}"?`)) {
      await window.propertyDB.delete(this.selectedProperty.id);
      this.allProperties = await window.propertyDB.getAll();
      this.closeDrawer();
      this.applyFiltersAndRender();
    }
  }

  // Import Modal & Tabs
  openImportModal() {
    document.getElementById('importModal')?.classList.add('active');
  }

  closeImportModal() {
    document.getElementById('importModal')?.classList.remove('active');
  }

  switchModalTab(tab, btnEl) {
    this.activeTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btnEl.classList.add('active');

    document.getElementById('tabUrlContent').style.display = tab === 'url' ? 'block' : 'none';
    document.getElementById('tabPasteContent').style.display = tab === 'paste' ? 'block' : 'none';
    document.getElementById('tabManualContent').style.display = tab === 'manual' ? 'block' : 'none';
    document.getElementById('tabPresetsContent').style.display = tab === 'presets' ? 'block' : 'none';

    const btnText = document.getElementById('scrapeBtnText');
    if (btnText) {
      btnText.innerText = tab === 'manual' ? 'Save Listing' : 'Scrape & Save';
    }
  }

  async handleScrapeSubmit() {
    const scrapeBtnText = document.getElementById('scrapeBtnText');

    // Handle Manual Tab Entry
    if (this.activeTab === 'manual') {
      const title = document.getElementById('manualTitle')?.value.trim();
      const rent = parseInt(document.getElementById('manualRent')?.value || '0', 10);
      const deposit = parseInt(document.getElementById('manualDeposit')?.value || '0', 10);
      const bhk = document.getElementById('manualBhk')?.value || '2 BHK';
      const locality = document.getElementById('manualLocality')?.value.trim() || 'Chennai';
      const lat = parseFloat(document.getElementById('manualLat')?.value || '12.9250');
      const lng = parseFloat(document.getElementById('manualLng')?.value || '80.1000');
      const photo = document.getElementById('manualPhoto')?.value.trim() || 'https://images.unsplash.com/photo-1560518883-ce09059eeffa?w=600&auto=format&fit=crop';

      if (!title || !rent) {
        alert('Please fill in at least the Property Title and Monthly Rent.');
        return;
      }

      const manualItem = {
        id: `prop_${Date.now()}`,
        source: 'Custom Entry',
        title,
        rent,
        deposit,
        maintenance: 0,
        sqft: 800,
        bhk,
        furnishing: 'Semi-Furnished',
        preferredTenant: 'All',
        locality,
        address: `${locality}, Chennai, Tamil Nadu`,
        latitude: lat,
        longitude: lng,
        description: 'Manually added property listing.',
        photos: [photo],
        url: '#',
        createdAt: Date.now()
      };

      await window.propertyDB.save(manualItem);
      this.allProperties = await window.propertyDB.getAll();
      this.closeImportModal();
      this.applyFiltersAndRender();
      alert('Listing saved successfully!');
      return;
    }

    // Handle URL / Raw Paste Scraper Tabs
    const urlInput = document.getElementById('urlInput');
    const pasteInput = document.getElementById('pasteInput');

    const inputVal = urlInput.value.trim() || pasteInput.value.trim();
    if (!inputVal) {
      alert('Please enter a valid URL or paste page HTML/JSON payload.');
      return;
    }

    try {
      scrapeBtnText.innerText = 'Processing...';
      const parsedItems = await window.listingScraper.parseUrlOrPayload(inputVal);

      if (!parsedItems || parsedItems.length === 0) {
        throw new Error('Could not parse property details from input.');
      }

      for (const item of parsedItems) {
        await window.propertyDB.save(item);
      }

      this.allProperties = await window.propertyDB.getAll();
      this.closeImportModal();
      this.applyFiltersAndRender();
      alert(`Successfully saved ${parsedItems.length} listing(s)!`);

      // Clear input
      urlInput.value = '';
      pasteInput.value = '';

    } catch (err) {
      alert(`Scraping Note: ${err.message}`);
    } finally {
      if (scrapeBtnText) scrapeBtnText.innerText = 'Scrape & Save';
    }
  }

  async loadPreset(type) {
    if (type === 'nb1') {
      document.getElementById('urlInput').value = 'https://www.nobroker.in/property/1-bhk-apartment-for-rent-in-mugavari-2nd-street-chennai-for-rs-13500/8aa9b54ea06c38c201a06c44fbca0698/detail';
    } else if (type === 'acres4') {
      document.getElementById('urlInput').value = 'https://www.99acres.com/4-bhk-bedroom-independent-house-villa-for-rent-in-old-perungalathur-chennai-south-1340-sqft-r2-spid-T91369142';
    } else if (type === 'sathya1') {
      document.getElementById('urlInput').value = 'https://www.nobroker.in/property/1-bhk-apartment-for-rent-in-11-72-east-tambaram-tambaram-tamil-nadu-600059-india-chennai-for-rs-9000/8a9fbf8283548f36018354fb4c394cd7/detail';
    }
    this.switchModalTab('url', document.getElementById('tabUrlBtn'));
  }

  async handleFileImport(e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const json = JSON.parse(event.target.result);
        await window.propertyDB.importJSON(json);
        this.allProperties = await window.propertyDB.getAll();
        this.applyFiltersAndRender();
        alert('Backup JSON imported successfully!');
      } catch (err) {
        alert('Error parsing JSON backup file.');
      }
    };
    reader.readAsText(file);
  }

  switchView(viewName) {
    this.currentView = viewName;
    const isMobile = window.innerWidth <= 768;

    // Update Header Navigation Tabs
    document.querySelectorAll('.nav-tab-btn').forEach(btn => btn.classList.remove('active'));
    if (viewName === 'list') document.getElementById('navTabList')?.classList.add('active');
    if (viewName === 'map') document.getElementById('navTabMap')?.classList.add('active');
    if (viewName === 'match') document.getElementById('navTabMatch')?.classList.add('active');

    // Update Mobile Bottom Nav Buttons
    document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-view') === viewName);
    });

    const listView = document.getElementById('listView');
    const mapView = document.getElementById('mapView');
    const matchView = document.getElementById('matchView');

    if (isMobile) {
      if (listView) listView.style.display = viewName === 'list' ? 'flex' : 'none';
      if (mapView) mapView.style.display = viewName === 'map' ? 'flex' : 'none';
      if (matchView) matchView.style.display = viewName === 'match' ? 'flex' : 'none';
    } else {
      if (viewName === 'match') {
        if (listView) listView.style.display = 'none';
        if (mapView) mapView.style.display = 'none';
        if (matchView) matchView.style.display = 'flex';
      } else {
        if (listView) listView.style.display = 'flex';
        if (mapView) mapView.style.display = 'flex';
        if (matchView) matchView.style.display = 'none';
      }
    }

    if (viewName === 'map' && window.mapController && window.mapController.map) {
      setTimeout(() => window.mapController.map.invalidateSize(), 200);
    }

    if (viewName === 'match') {
      this.renderBestMatchView();
    }

    if (window.lucide) window.lucide.createIcons();
  }

  calculateMatchScores() {
    if (!this.allProperties || this.allProperties.length === 0) return [];

    const totalWeight = (this.weights.rent + this.weights.space + this.weights.transit + this.weights.deposit) || 100;

    return this.allProperties.map(prop => {
      // 1. Rent Economy Score
      let benchmarkRent = 22000;
      if (prop.bhk.includes('1')) benchmarkRent = 16000;
      else if (prop.bhk.includes('2')) benchmarkRent = 22000;
      else if (prop.bhk.includes('3')) benchmarkRent = 35000;
      else if (prop.bhk.includes('4')) benchmarkRent = 50000;

      const rentDiffRatio = (benchmarkRent - prop.rent) / benchmarkRent;
      const rentScore = Math.max(0, Math.min(100, Math.round(50 + rentDiffRatio * 100)));

      // 2. Carpet Area / Space Efficiency Score
      const bhkNum = parseInt(prop.bhk, 10) || 1;
      const sqftPerBhk = prop.sqft / bhkNum;
      const spaceScore = Math.max(0, Math.min(100, Math.round((sqftPerBhk / 450) * 75)));

      // 3. Deposit Score (3x rent = 100, 4x = 80, 5x = 60)
      const depRatio = prop.deposit / Math.max(1, prop.rent);
      let depositScore = 100;
      if (depRatio > 3) depositScore = Math.max(0, Math.round(100 - (depRatio - 3) * 20));

      // 4. Transit / Station Proximity Score
      const distKm = Math.sqrt(Math.pow(prop.latitude - 12.9049, 2) + Math.pow(prop.longitude - 80.0846, 2)) * 111;
      let transitScore = 95;
      if (distKm > 1.5) transitScore = Math.max(40, Math.round(100 - distKm * 10));

      const overallScore = Math.round(
        (rentScore * this.weights.rent +
         spaceScore * this.weights.space +
         transitScore * this.weights.transit +
         depositScore * this.weights.deposit) / totalWeight
      );

      // Highlights / Pros & Cons
      const pros = [];
      const cons = [];

      if (prop.rent <= 16000) pros.push(`Budget Friendly (₹${prop.rent.toLocaleString()}/mo)`);
      else if (prop.rent > 30000) cons.push(`Higher Rent (₹${prop.rent.toLocaleString()}/mo)`);

      if (sqftPerBhk >= 500) pros.push(`Spacious Layout (${prop.sqft} sqft)`);
      else cons.push(`Compact Area (${prop.sqft} sqft)`);

      if (depRatio <= 3) pros.push(`Low Deposit (${depRatio.toFixed(1)}x Rent)`);
      else if (depRatio >= 5) cons.push(`High Deposit (${depRatio.toFixed(1)}x Rent)`);

      if (distKm <= 2) pros.push(`Close to Railway Station (${distKm.toFixed(1)} km)`);

      return {
        ...prop,
        matchScore: overallScore,
        rentScore,
        spaceScore,
        depositScore,
        transitScore,
        distKm: distKm.toFixed(1),
        pros,
        cons
      };
    }).sort((a, b) => b.matchScore - a.matchScore);
  }

  renderBestMatchView() {
    const container = document.getElementById('matchFeedGrid');
    if (!container) return;

    const ranked = this.calculateMatchScores();

    if (ranked.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--text-muted);">
          <i data-lucide="inbox" style="width: 48px; height: 48px; margin-bottom: 12px; opacity: 0.5;"></i>
          <h3>No properties listed yet.</h3>
          <p style="font-size: 0.85rem; margin-top: 6px;">Add property links or listings to calculate the Best Match scores.</p>
        </div>
      `;
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    container.innerHTML = ranked.map((prop, idx) => {
      const isTop = idx === 0;
      const isChecked = this.selectedForComparison.has(prop.id);
      
      let badgeLabel = `#${idx + 1} RANKED`;
      if (idx === 0) badgeLabel = '🏆 #1 TOP MATCH';
      else if (idx === 1) badgeLabel = '⭐ #2 BEST VALUE';
      else if (idx === 2) badgeLabel = '📍 #3 TOP LOCATION';

      const thumb = prop.photos && prop.photos[0] ? prop.photos[0] : 'https://imagecdn.99acres.com/media1/42388/11/847771685O-1790470546077.jpg';
      const scoreClass = prop.matchScore >= 80 ? 'high' : 'med';

      return `
        <div class="match-card ${isTop ? 'top-rank' : ''}">
          <span class="match-rank-badge">${badgeLabel}</span>
          <span class="match-score-pill ${scoreClass}">
            <i data-lucide="sparkles" style="width:14px;height:14px;"></i> ${prop.matchScore}% Match
          </span>

          <div class="card-img-wrap" style="height:170px;">
            <img src="${thumb}" alt="property" onerror="this.src='https://cdn-icons-png.flaticon.com/512/609/609803.png';" />
            <span class="card-source-badge">${prop.source}</span>
            <span class="card-price-badge">₹${prop.rent.toLocaleString()}/mo</span>
          </div>

          <div class="card-body" style="padding:14px; flex:1; display:flex; flex-direction:column;">
            <h3 class="card-title" style="font-size:0.95rem; line-height:1.3; margin-bottom:6px;">${prop.title}</h3>
            
            <div class="card-address" onclick="event.stopPropagation(); window.open('https://www.google.com/maps/search/?api=1&query=${prop.latitude},${prop.longitude}', '_blank')" title="Open location in Google Maps">
              <i data-lucide="map-pin"></i> ${prop.locality || prop.address} ↗
            </div>

            <div class="match-pros-cons">
              ${prop.pros.map(p => `<span class="pro-tag"><i data-lucide="check-circle-2" style="width:12px;height:12px;"></i> ${p}</span>`).join('')}
              ${prop.cons.map(c => `<span class="con-tag"><i data-lucide="alert-circle" style="width:12px;height:12px;"></i> ${c}</span>`).join('')}
            </div>

            <div class="card-specs" style="margin-top:auto; padding-top:10px;">
              <span class="spec-item"><i data-lucide="home"></i> ${prop.bhk}</span>
              <span class="spec-item"><i data-lucide="maximize"></i> ${prop.sqft} sqft</span>
              <span class="spec-item"><i data-lucide="shield"></i> Dep: ₹${(prop.deposit/1000).toFixed(0)}k</span>
            </div>

            <div style="display:flex; align-items:center; justify-content:space-between; margin-top:12px; padding-top:8px; border-top:1px solid var(--border-color);">
              <label style="font-size:0.8rem; color:var(--text-muted); cursor:pointer; display:flex; align-items:center; gap:6px;">
                <input type="checkbox" ${isChecked ? 'checked' : ''} onchange="window.app.toggleCompareProperty('${prop.id}')" /> Compare
              </label>
              <button class="btn btn-secondary" onclick="window.app.selectProperty('${prop.id}')" style="font-size:0.75rem; padding:4px 10px;">
                View Details
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    if (window.lucide) window.lucide.createIcons();
  }

  toggleWeightsPanel() {
    const panel = document.getElementById('weightsPanel');
    if (panel) {
      panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    }
  }

  onWeightChange() {
    const rentVal = parseInt(document.getElementById('sliderWeightRent')?.value || '40', 10);
    const spaceVal = parseInt(document.getElementById('sliderWeightSpace')?.value || '30', 10);
    const transitVal = parseInt(document.getElementById('sliderWeightTransit')?.value || '20', 10);
    const depositVal = parseInt(document.getElementById('sliderWeightDeposit')?.value || '10', 10);

    const elRent = document.getElementById('valWeightRent');
    const elSpace = document.getElementById('valWeightSpace');
    const elTransit = document.getElementById('valWeightTransit');
    const elDep = document.getElementById('valWeightDeposit');

    if (elRent) elRent.innerText = `${rentVal}%`;
    if (elSpace) elSpace.innerText = `${spaceVal}%`;
    if (elTransit) elTransit.innerText = `${transitVal}%`;
    if (elDep) elDep.innerText = `${depositVal}%`;

    this.weights = { rent: rentVal, space: spaceVal, transit: transitVal, deposit: depositVal };
    this.renderBestMatchView();
  }

  toggleCompareProperty(id) {
    if (this.selectedForComparison.has(id)) {
      this.selectedForComparison.delete(id);
    } else {
      if (this.selectedForComparison.size >= 4) {
        alert('You can compare up to 4 properties side-by-side.');
        return;
      }
      this.selectedForComparison.add(id);
    }

    const compareBtn = document.getElementById('compareSelectedBtn');
    if (compareBtn) {
      compareBtn.innerText = `Compare Selected (${this.selectedForComparison.size})`;
      compareBtn.disabled = this.selectedForComparison.size < 2;
    }
    this.renderBestMatchView();
  }

  openComparisonModal() {
    const modal = document.getElementById('comparisonModal');
    const body = document.getElementById('comparisonModalBody');
    if (!modal || !body) return;

    const selectedProps = this.calculateMatchScores().filter(p => this.selectedForComparison.has(p.id));

    if (selectedProps.length < 2) {
      alert('Please select at least 2 properties to compare side-by-side.');
      return;
    }

    body.innerHTML = `
      <div class="comparison-table-wrap">
        <table class="comparison-table">
          <thead>
            <tr>
              <th>Feature / Metric</th>
              ${selectedProps.map(p => `<th>${p.title.slice(0, 28)}...</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Match Score</strong></td>
              ${selectedProps.map(p => `<td><strong style="color:var(--primary); font-size:1rem;">${p.matchScore}% Match</strong></td>`).join('')}
            </tr>
            <tr>
              <td><strong>Monthly Rent</strong></td>
              ${selectedProps.map(p => `<td>₹${p.rent.toLocaleString()}/mo</td>`).join('')}
            </tr>
            <tr>
              <td><strong>Security Deposit</strong></td>
              ${selectedProps.map(p => `<td>₹${p.deposit.toLocaleString()} (${(p.deposit/p.rent).toFixed(1)}x)</td>`).join('')}
            </tr>
            <tr>
              <td><strong>Carpet Area (Sqft)</strong></td>
              ${selectedProps.map(p => `<td>${p.sqft} sqft (${(p.sqft/parseInt(p.bhk,10)).toFixed(0)} sqft/BHK)</td>`).join('')}
            </tr>
            <tr>
              <td><strong>BHK Type</strong></td>
              ${selectedProps.map(p => `<td>${p.bhk}</td>`).join('')}
            </tr>
            <tr>
              <td><strong>Locality & Distance</strong></td>
              ${selectedProps.map(p => `<td>${p.locality}<br/><span style="font-size:0.75rem; color:var(--text-muted);">${p.distKm} km to Station</span></td>`).join('')}
            </tr>
            <tr>
              <td><strong>Furnishing</strong></td>
              ${selectedProps.map(p => `<td>${p.furnishing}</td>`).join('')}
            </tr>
            <tr>
              <td><strong>Source</strong></td>
              ${selectedProps.map(p => `<td>${p.source}</td>`).join('')}
            </tr>
            <tr>
              <td><strong>Actions</strong></td>
              ${selectedProps.map(p => `
                <td>
                  <a href="${p.url}" target="_blank" class="btn btn-primary" style="font-size:0.75rem; padding:4px 8px; text-decoration:none;">Open Link ↗</a>
                </td>
              `).join('')}
            </tr>
          </tbody>
        </table>
      </div>
    `;

    modal.classList.add('active');
    if (window.lucide) window.lucide.createIcons();
  }

  closeComparisonModal() {
    document.getElementById('comparisonModal')?.classList.remove('active');
  }
}

window.app = new AppController();
document.addEventListener('DOMContentLoaded', () => window.app.init());
