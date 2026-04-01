const PREFIX = 'declanalytics_';

type CacheOptions = {
  storage?: 'session' | 'local';
  ttl?: number; // ms
};

const DEFAULT_TTL = 1000 * 60 * 60; // 1 hour

function evictOldest(store: Storage, bytesNeeded: number) {
  const entries: { key: string; expires: number; size: number }[] = [];
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i);
    if (!key?.startsWith(PREFIX)) continue;
    try {
      const raw = store.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      entries.push({ key, expires: parsed.expires ?? 0, size: raw.length });
    } catch {
      // Remove corrupt entries
      if (key) store.removeItem(key);
    }
  }
  // Sort oldest first
  entries.sort((a, b) => a.expires - b.expires);
  let freed = 0;
  for (const entry of entries) {
    if (freed >= bytesNeeded) break;
    store.removeItem(entry.key);
    freed += entry.size;
  }
}

export const CacheService = {
  set<T>(key: string, data: T, options: CacheOptions = {}) {
    if (typeof window === 'undefined') return;

    const { storage = 'session', ttl = DEFAULT_TTL } = options;
    const store = storage === 'local' ? localStorage : sessionStorage;
    const entry = { data, timestamp: Date.now(), expires: Date.now() + ttl };

    try {
      const json = JSON.stringify(entry);
      try {
        store.setItem(PREFIX + key, json);
      } catch {
        // Quota exceeded — evict oldest entries and retry once
        evictOldest(store, json.length * 2);
        try {
          store.setItem(PREFIX + key, json);
        } catch {
          // Still full — silently skip caching
        }
      }
    } catch {
      // JSON serialization error — skip
    }
  },

  get<T>(key: string, storage: 'session' | 'local' = 'session'): T | null {
    if (typeof window === 'undefined') return null;

    const store = storage === 'local' ? localStorage : sessionStorage;
    const item = store.getItem(PREFIX + key);

    if (!item) return null;

    try {
      const entry = JSON.parse(item);
      if (Date.now() > entry.expires) {
        store.removeItem(PREFIX + key);
        return null;
      }
      return entry.data as T;
    } catch {
      return null;
    }
  },

  remove(key: string) {
    if (typeof window === 'undefined') return;
    sessionStorage.removeItem(PREFIX + key);
    localStorage.removeItem(PREFIX + key);
  },

  clear() {
    if (typeof window === 'undefined') return;
    Object.keys(sessionStorage).forEach(k => {
      if (k.startsWith(PREFIX)) sessionStorage.removeItem(k);
    });
    Object.keys(localStorage).forEach(k => {
      if (k.startsWith(PREFIX)) localStorage.removeItem(k);
    });
  }
};
