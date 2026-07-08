import type { CacheFamily } from "./cachePolicy";
import type { MemoryCacheEntry } from "./lruMemoryCache";
import { recordCacheMetric } from "./cacheMetrics";

const DB_NAME = "losod-app-cache";
const DB_VERSION = 1;
const STORE_NAME = "responses";
const MAX_PERSISTED_ENTRIES = 50;

type PersistedEntry = MemoryCacheEntry & {
  lastAccessedAt: number;
};

function canUseIndexedDb() {
  return typeof indexedDB !== "undefined";
}

function openDb() {
  if (!canUseIndexedDb()) return Promise.resolve(undefined);
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("family", "family");
        store.createIndex("lastAccessedAt", "lastAccessedAt");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withStore<T>(mode: IDBTransactionMode, callback: (store: IDBObjectStore) => IDBRequest<T> | void) {
  return openDb().then((db) => {
    if (!db) return undefined;
    return new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, mode);
      const store = tx.objectStore(STORE_NAME);
      const request = callback(store);
      let result: T | undefined;
      if (request) {
        request.onsuccess = () => {
          result = request.result;
        };
        request.onerror = () => reject(request.error);
      }
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  });
}

async function enforceLimit() {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const countRequest = store.count();
    countRequest.onsuccess = () => {
      const extra = countRequest.result - MAX_PERSISTED_ENTRIES;
      if (extra <= 0) return;
      let removed = 0;
      const cursorRequest = store.index("lastAccessedAt").openCursor();
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor || removed >= extra) return;
        cursor.delete();
        removed += 1;
        recordCacheMetric("eviction");
        cursor.continue();
      };
    };
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };
  });
}

export const indexedDbCacheStore = {
  async get<T>(key: string) {
    const entry = await withStore<PersistedEntry>("readonly", (store) => store.get(key));
    if (!entry) return undefined;
    await this.set({ ...entry, value: entry.value as T });
    return entry as MemoryCacheEntry<T>;
  },

  async set<T>(entry: MemoryCacheEntry<T>) {
    await withStore("readwrite", (store) => {
      store.put({ ...entry, lastAccessedAt: Date.now() } satisfies PersistedEntry);
    });
    await enforceLimit();
  },

  async invalidateFamily(family: CacheFamily) {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const cursorRequest = store.index("family").openCursor(IDBKeyRange.only(family));
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error);
      };
    });
  },

  async clear() {
    await withStore("readwrite", (store) => {
      store.clear();
    });
  },
};

