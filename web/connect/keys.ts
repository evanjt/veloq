// What is kept between visits, in the browser's IndexedDB: this browser's
// certificate and the fingerprint of the paired phone.

export interface Keys {
  read: <T>(key: string) => Promise<T | undefined>;
  write: (key: string, value: unknown) => Promise<unknown>;
  drop: (key: string) => Promise<unknown>;
}

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('veloq-connect', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('keys');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withKeys<T = unknown>(
  mode: 'readonly' | 'readwrite',
  use: (keys: IDBObjectStore) => IDBRequest
): Promise<T> {
  const db = await openStore();
  return new Promise<T>((resolve, reject) => {
    const request = use(db.transaction('keys', mode).objectStore('keys'));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** The keys in the page's own IndexedDB. */
export const browserKeys: Keys = {
  read: <T>(key: string) => withKeys<T | undefined>('readonly', (keys) => keys.get(key)),
  write: (key, value) => withKeys('readwrite', (keys) => keys.put(value, key)),
  drop: (key) => withKeys('readwrite', (keys) => keys.delete(key)),
};
