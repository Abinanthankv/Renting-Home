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
            <div class="card-address"><i data-lucide="map-pin"></i> ${prop.locality || prop.address}</div>
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

      <div style="font-size:0.85rem; color: var(--text-muted); display:flex; align-items:flex-start; gap:6px;">
        <i data-lucide="map-pin" style="color:var(--primary);flex-shrink:0;margin-top:2px;"></i>
        <span>${prop.address}</span>
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
}

window.app = new AppController();
document.addEventListener('DOMContentLoaded', () => window.app.init());
