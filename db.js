/**
 * Dual Storage Engine for Rent Radar PWA (IndexedDB with LocalStorage Fallback)
 * Works seamlessly on file://, localhost, and GitHub Pages.
 */
const DB_NAME = 'RentRadarDB';
const DB_VERSION = 1;
const STORE_NAME = 'properties';
const LOCAL_STORAGE_KEY = 'rent_radar_properties';

class PropertyDB {
  constructor() {
    this.db = null;
    this.useLocalStorage = false;
    this.memoryStore = [];
  }

  async init() {
    try {
      if (!window.indexedDB) {
        throw new Error('IndexedDB not supported, falling back to LocalStorage.');
      }

      return await new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = event.target.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            store.createIndex('createdAt', 'createdAt', { unique: false });
            store.createIndex('source', 'source', { unique: false });
            store.createIndex('rent', 'rent', { unique: false });
            store.createIndex('bhk', 'bhk', { unique: false });
          }
        };

        request.onsuccess = (event) => {
          this.db = event.target.result;
          resolve(this.db);
        };

        request.onerror = (event) => {
          console.warn('IndexedDB blocked or disabled. Using LocalStorage fallback:', event.target.error);
          this.useLocalStorage = true;
          resolve(null);
        };
      });
    } catch (e) {
      console.warn('IndexedDB init fallback to LocalStorage:', e.message);
      this.useLocalStorage = true;
      return null;
    }
  }

  async save(property) {
    const record = {
      ...property,
      id: property.id || `prop_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      createdAt: property.createdAt || Date.now(),
      updatedAt: Date.now()
    };

    if (this.useLocalStorage || !this.db) {
      return this.saveToLocalStorage(record);
    }

    try {
      return await new Promise((resolve, reject) => {
        const tx = this.db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(record);
        request.onsuccess = () => resolve(record);
        request.onerror = () => resolve(this.saveToLocalStorage(record));
      });
    } catch (e) {
      return this.saveToLocalStorage(record);
    }
  }

  saveToLocalStorage(record) {
    try {
      const items = this.getLocalStorageItems();
      const index = items.findIndex(i => i.id === record.id);
      if (index >= 0) {
        items[index] = record;
      } else {
        items.unshift(record);
      }
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
    } catch (e) {
      console.warn('LocalStorage save warning:', e);
    }
    return record;
  }

  async getAll() {
    if (this.useLocalStorage || !this.db) {
      return this.getLocalStorageItems();
    }

    try {
      return await new Promise((resolve) => {
        const tx = this.db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('createdAt');
        const request = index.getAll();

        request.onsuccess = () => {
          const results = request.result || [];
          resolve(results.reverse());
        };
        request.onerror = () => resolve(this.getLocalStorageItems());
      });
    } catch (e) {
      return this.getLocalStorageItems();
    }
  }

  getLocalStorageItems() {
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return this.memoryStore;
    }
  }

  async getById(id) {
    const all = await this.getAll();
    return all.find(item => item.id === id) || null;
  }

  async delete(id) {
    if (this.useLocalStorage || !this.db) {
      let items = this.getLocalStorageItems();
      items = items.filter(i => i.id !== id);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
      return true;
    }

    try {
      return await new Promise((resolve) => {
        const tx = this.db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.delete(id);
        request.onsuccess = () => resolve(true);
        request.onerror = () => {
          let items = this.getLocalStorageItems();
          items = items.filter(i => i.id !== id);
          localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
          resolve(true);
        };
      });
    } catch (e) {
      let items = this.getLocalStorageItems();
      items = items.filter(i => i.id !== id);
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
      return true;
    }
  }

  async clearAll() {
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    this.memoryStore = [];
    if (this.db) {
      try {
        const tx = this.db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).clear();
      } catch (e) {}
    }
    return true;
  }

  async exportJSON() {
    const all = await this.getAll();
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(all, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `rent_radar_backup_${new Date().toISOString().slice(0,10)}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }

  async importJSON(items) {
    if (!Array.isArray(items)) throw new Error('Invalid JSON format');
    for (const item of items) {
      if (item.title && item.rent) {
        await this.save(item);
      }
    }
  }
}

window.propertyDB = new PropertyDB();
