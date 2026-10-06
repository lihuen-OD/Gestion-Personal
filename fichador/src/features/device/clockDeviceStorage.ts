export type StoredClockDeviceIdentity = { id: string; secret: string };

const DB_NAME = "fichador-device";
const STORE_NAME = "identity";
const IDENTITY_KEY = "current";

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const request = run(tx.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => reject(tx.error);
  });
}

export const clockDeviceStorage = {
  get: () => transaction<StoredClockDeviceIdentity | undefined>("readonly", (store) => store.get(IDENTITY_KEY)),
  set: (identity: StoredClockDeviceIdentity) => transaction<IDBValidKey>("readwrite", (store) => store.put(identity, IDENTITY_KEY)).then(() => undefined),
  clear: () => transaction<undefined>("readwrite", (store) => store.delete(IDENTITY_KEY)).then(() => undefined),
};
