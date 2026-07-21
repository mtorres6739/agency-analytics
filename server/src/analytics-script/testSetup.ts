const storage = new Map<string, string>();

const localStoragePolyfill: Storage = {
  get length() {
    return storage.size;
  },
  clear() {
    storage.clear();
  },
  getItem(key: string) {
    return storage.get(key) ?? null;
  },
  key(index: number) {
    return [...storage.keys()][index] ?? null;
  },
  removeItem(key: string) {
    storage.delete(key);
  },
  setItem(key: string, value: string) {
    storage.set(key, String(value));
  },
};

// Always replace jsdom/Node storage with one stable, configurable object.
// Tracking tests restore spies between cases; jsdom's accessor-backed Storage
// can otherwise yield non-spy methods after a restore in clean CI workers.
Object.defineProperty(globalThis, "localStorage", {
  value: localStoragePolyfill,
  configurable: true,
  writable: true,
});
