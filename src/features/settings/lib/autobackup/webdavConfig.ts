/**
 * WebDAV credential storage (SecureStore).
 *
 * Separated from autoBackup.ts to avoid circular dependency with webdavBackend.ts.
 */

import * as SecureStore from 'expo-secure-store';

const WEBDAV_URL_KEY = 'veloq-webdav-url';
const WEBDAV_USERNAME_KEY = 'veloq-webdav-username';
const WEBDAV_PASSWORD_KEY = 'veloq-webdav-password';
const WEBDAV_PLAIN_LAN_KEY = 'veloq-webdav-plain-lan';

export interface WebdavConfig {
  url: string;
  username: string;
  password: string;
  /** The athlete accepted an unencrypted server on their own network. */
  plainLan: boolean;
}

export type WebdavUrlProblem = 'empty' | 'invalid' | 'not-https';

const PRIVATE_HOST =
  /^(localhost|127(\.\d{1,3}){3}|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|[^.]+\.(local|lan|home|internal))$/i;

/**
 * Why an address cannot take the athlete's password and database, or null.
 * The payload crosses as Basic auth and a raw file, so only https carries it,
 * except to a private host the athlete has explicitly allowed.
 */
export function webdavUrlProblem(url: string, plainLan = false): WebdavUrlProblem | null {
  const trimmed = url.trim();
  if (!trimmed) return 'empty';
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return 'invalid';
  }
  if (parsed.protocol === 'https:') return null;
  if (parsed.protocol === 'http:' && plainLan && PRIVATE_HOST.test(parsed.hostname)) return null;
  return 'not-https';
}

const PROBLEM_MESSAGES: Record<WebdavUrlProblem, string> = {
  empty: 'No WebDAV server address',
  invalid: 'The WebDAV server address is not a URL',
  'not-https': 'The WebDAV server address must use https',
};

export function webdavUrlProblemMessage(problem: WebdavUrlProblem): string {
  return PROBLEM_MESSAGES[problem];
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
  return webdavUrlProblem(config.url, config.plainLan);
}

/** Load WebDAV config from SecureStore into cache. Call on app startup. */
export async function initWebdavConfig(): Promise<void> {
  try {
    const [url, username, password, plainLan] = await Promise.all([
      SecureStore.getItemAsync(WEBDAV_URL_KEY),
      SecureStore.getItemAsync(WEBDAV_USERNAME_KEY),
      SecureStore.getItemAsync(WEBDAV_PASSWORD_KEY),
      SecureStore.getItemAsync(WEBDAV_PLAIN_LAN_KEY),
    ]);
    if (url && username && password) {
      _webdavCache = { url, username, password, plainLan: plainLan === '1' };
    } else {
      _webdavCache = null;
    }
  } catch {
    _webdavCache = null;
  }
}

/** Save WebDAV config to SecureStore and cache. Throws on an address that would send in the clear. */
export async function setWebdavConfig(
  url: string,
  username: string,
  password: string,
  plainLan = false
): Promise<void> {
  const problem = webdavUrlProblem(url, plainLan);
  if (problem) throw new Error(webdavUrlProblemMessage(problem));
  const opts = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
  await Promise.all([
    SecureStore.setItemAsync(WEBDAV_URL_KEY, url, opts),
    SecureStore.setItemAsync(WEBDAV_USERNAME_KEY, username, opts),
    SecureStore.setItemAsync(WEBDAV_PASSWORD_KEY, password, opts),
    SecureStore.setItemAsync(WEBDAV_PLAIN_LAN_KEY, plainLan ? '1' : '0', opts),
  ]);
  _webdavCache = { url, username, password, plainLan };
}

/** Clear WebDAV config from SecureStore and cache. */
export async function clearWebdavConfig(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(WEBDAV_URL_KEY),
    SecureStore.deleteItemAsync(WEBDAV_USERNAME_KEY),
    SecureStore.deleteItemAsync(WEBDAV_PASSWORD_KEY),
    SecureStore.deleteItemAsync(WEBDAV_PLAIN_LAN_KEY),
  ]);
  _webdavCache = null;
}
