/**
 * WebDAV credential storage (SecureStore).
 *
 * Separated from autoBackup.ts to avoid circular dependency with webdavBackend.ts.
 */

import * as SecureStore from 'expo-secure-store';

import { addressFailure } from './backends/errors';

const WEBDAV_URL_KEY = 'veloq-webdav-url';
const WEBDAV_USERNAME_KEY = 'veloq-webdav-username';
const WEBDAV_PASSWORD_KEY = 'veloq-webdav-password';
/** Written by builds that asked for an opt-in to plain http. Nothing reads it now; clearing removes it. */
const LEGACY_PLAIN_LAN_KEY = 'veloq-webdav-plain-lan';

export interface WebdavConfig {
  url: string;
  username: string;
  password: string;
}

export type WebdavUrlProblem = 'empty' | 'invalid' | 'not-http';

/**
 * Why an address cannot be a WebDAV server, or null. Both http and https are
 * accepted for any host, because people self-host WebDAV; `isPlainHttp` is what
 * the form warns on.
 */
export function webdavUrlProblem(url: string): WebdavUrlProblem | null {
  const trimmed = url.trim();
  if (!trimmed) return 'empty';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return 'invalid';
  }
  if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return null;
  return 'not-http';
}

/** Whether an address sends the password and record archive unencrypted. */
export function isPlainHttp(url: string): boolean {
  return /^\s*http:/i.test(url);
}

// In-memory cache (SecureStore is async but we need sync access for isAvailable)
let _webdavCache: WebdavConfig | null = null;

/** Get WebDAV config (synchronous from cache, call initWebdavConfig first). */
export function getWebdavConfig(): WebdavConfig | null {
  return _webdavCache;
}

/** The stored config's address problem, so a backend never sends to one. */
export function webdavConfigProblem(): WebdavUrlProblem | null {
  const config = _webdavCache;
  if (!config) return 'empty';
  return webdavUrlProblem(config.url);
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

/**
 * Save WebDAV config to SecureStore and cache. Rejects with an `address` failure
 * for an address that is not http or https.
 */
export async function setWebdavConfig(
  url: string,
  username: string,
  password: string
): Promise<void> {
  const problem = webdavUrlProblem(url);
  if (problem) throw addressFailure('Save WebDAV server', problem);
  const opts = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  await Promise.all([
    SecureStore.setItemAsync(WEBDAV_URL_KEY, url, opts),
    SecureStore.setItemAsync(WEBDAV_USERNAME_KEY, username, opts),
    SecureStore.setItemAsync(WEBDAV_PASSWORD_KEY, password, opts),
  ]);
  _webdavCache = { url, username, password };
}

/**
 * Clear WebDAV config from SecureStore and cache. The cache goes first, so a
 * failed keychain delete cannot leave the config readable. Every key is still
 * attempted, and the first failure is thrown once all of them have settled.
 */
export async function clearWebdavConfig(): Promise<void> {
  _webdavCache = null;
  const results = await Promise.allSettled(
    [WEBDAV_URL_KEY, WEBDAV_USERNAME_KEY, WEBDAV_PASSWORD_KEY, LEGACY_PLAIN_LAN_KEY].map((key) =>
      Promise.resolve().then(() => SecureStore.deleteItemAsync(key))
    )
  );
  const failed = results.find((result) => result.status === 'rejected');
  if (failed) throw failed.reason;
}
