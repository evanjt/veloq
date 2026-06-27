/**
 * WebDAV credential storage (SecureStore).
 *
 * Separated from autoBackup.ts to avoid circular dependency with webdavBackend.ts.
 */

import * as SecureStore from 'expo-secure-store';

const WEBDAV_URL_KEY = 'veloq-webdav-url';
const WEBDAV_USERNAME_KEY = 'veloq-webdav-username';
const WEBDAV_PASSWORD_KEY = 'veloq-webdav-password';

// In-memory cache (SecureStore is async but we need sync access for isAvailable)
let _webdavCache: { url: string; username: string; password: string } | null = null;

/** Get WebDAV config (synchronous from cache, call initWebdavConfig first). */
export function getWebdavConfig(): { url: string; username: string; password: string } | null {
  return _webdavCache;
}

/** Load WebDAV config from SecureStore into cache. Call on app startup. */
export async function initWebdavConfig(): Promise<void> {
  try {
    const [url, username, password] = await Promise.all([
      SecureStore.getItemAsync(WEBDAV_URL_KEY),
      SecureStore.getItemAsync(WEBDAV_USERNAME_KEY),
      SecureStore.getItemAsync(WEBDAV_PASSWORD_KEY),
    ]);
    if (url && username && password) {
      _webdavCache = { url, username, password };
    } else {
      _webdavCache = null;
    }
  } catch {
    _webdavCache = null;
  }
}

/** Save WebDAV config to SecureStore and cache. */
export async function setWebdavConfig(
  url: string,
  username: string,
  password: string
): Promise<void> {
  const opts = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  await Promise.all([
    SecureStore.setItemAsync(WEBDAV_URL_KEY, url, opts),
    SecureStore.setItemAsync(WEBDAV_USERNAME_KEY, username, opts),
    SecureStore.setItemAsync(WEBDAV_PASSWORD_KEY, password, opts),
  ]);
  _webdavCache = { url, username, password };
}

/** Clear WebDAV config from SecureStore and cache. */
export async function clearWebdavConfig(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(WEBDAV_URL_KEY),
    SecureStore.deleteItemAsync(WEBDAV_USERNAME_KEY),
    SecureStore.deleteItemAsync(WEBDAV_PASSWORD_KEY),
  ]);
  _webdavCache = null;
}
