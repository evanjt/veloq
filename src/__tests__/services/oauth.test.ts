/**
 * OAuth service tests
 *
 * Covers CSRF state generation, authorization URL construction,
 * state registration with proxy, callback parsing, and validation.
 *
 * The OAuth flow uses a proxy (Cloudflare Worker) that holds the
 * client_secret — the proxy exchanges the code for a token and
 * redirects back to the app with token params in the URL.
 */

// Mock expo-crypto: deterministic getRandomBytes for state generation
jest.mock('expo-crypto', () => ({
  getRandomBytes: jest.fn((length: number) => {
    // Return deterministic bytes (0x00, 0x11, 0x22, ...) for reproducible state
    const arr = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      arr[i] = i * 0x11;
    }
    return arr;
  }),
}));

// Mock expo-web-browser: stub openAuthSessionAsync
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
}));

// Mock expo-linking: use a real-ish parse implementation that reads query params
jest.mock('expo-linking', () => ({
  parse: jest.fn((url: string) => {
    const u = new URL(url);
    const params: Record<string, string> = {};
    u.searchParams.forEach((v, k) => {
      params[k] = v;
    });
    return {
      scheme: u.protocol.replace(':', ''),
      hostname: u.hostname,
      path: u.pathname,
      queryParams: params,
    };
  }),
}));

import * as WebBrowser from 'expo-web-browser';
import {
  isOAuthConfigured,
  getOAuthClientId,
  getProxyRedirectUri,
  buildAuthorizationUrl,
  startOAuthFlow,
  parseCallbackUrl,
  validateState,
  handleOAuthCallback,
  getAppRedirectUri,
} from '@/services/oauth';
import { OAUTH } from '@/lib/utils/constants';

const mockedOpenAuth = WebBrowser.openAuthSessionAsync as jest.MockedFunction<
  typeof WebBrowser.openAuthSessionAsync
>;

// fetch is used for state registration with the proxy
const originalFetch = global.fetch;

describe('OAuth service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset global fetch to a passing stub by default
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('isOAuthConfigured()', () => {
    it('returns true when CLIENT_ID and PROXY_URL are populated', () => {
      expect(isOAuthConfigured()).toBe(true);
      expect(OAUTH.CLIENT_ID).not.toBe('');
      expect(OAUTH.PROXY_URL).not.toBe('');
    });
  });

  describe('getOAuthClientId()', () => {
    it('returns the configured client ID string', () => {
      expect(getOAuthClientId()).toBe(OAUTH.CLIENT_ID);
    });
  });

  describe('getProxyRedirectUri()', () => {
    it('returns PROXY_URL + /oauth/callback', () => {
      expect(getProxyRedirectUri()).toBe(`${OAUTH.PROXY_URL}/oauth/callback`);
    });
  });

  describe('getAppRedirectUri()', () => {
    it('returns APP_SCHEME + ://oauth/callback', () => {
      expect(getAppRedirectUri()).toBe(`${OAUTH.APP_SCHEME}://oauth/callback`);
    });
  });

  describe('buildAuthorizationUrl()', () => {
    afterEach(() => {
      // Clear module-level state by calling validateState with something
      // validateState clears oauthState after reading
      try {
        validateState('anything');
      } catch {
        // no-op
      }
    });

    it('throws if oauth state has not been initialized', () => {
      // Fresh module-level state is null; calling buildAuthorizationUrl
      // before startOAuthFlow must throw
      expect(() => buildAuthorizationUrl()).toThrow(/state not initialized/i);
    });

    it('produces a URL containing client_id, redirect_uri, scope, and state when state is set', async () => {
      mockedOpenAuth.mockResolvedValue({
        type: 'dismiss',
      } as WebBrowser.WebBrowserAuthSessionResult);
      await startOAuthFlow();

      const url = buildAuthorizationUrl();
      expect(url.startsWith(OAUTH.AUTH_ENDPOINT + '?')).toBe(true);

      const parsed = new URL(url);
      expect(parsed.searchParams.get('client_id')).toBe(OAUTH.CLIENT_ID);
      expect(parsed.searchParams.get('redirect_uri')).toBe(`${OAUTH.PROXY_URL}/oauth/callback`);
      expect(parsed.searchParams.get('response_type')).toBe('code');
      expect(parsed.searchParams.get('scope')).toBe(OAUTH.SCOPES.join(','));
      // State is a 64-char hex string (32 bytes × 2 chars/byte)
      const state = parsed.searchParams.get('state') ?? '';
      expect(state).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('startOAuthFlow()', () => {
    it('registers state with proxy via POST and opens auth session', async () => {
      mockedOpenAuth.mockResolvedValue({
        type: 'success',
        url: '',
      } as WebBrowser.WebBrowserAuthSessionResult);

      await startOAuthFlow();

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
      expect(url).toBe(`${OAUTH.PROXY_URL}/oauth/state`);
      expect(opts.method).toBe('POST');
      expect(opts.headers['Content-Type']).toBe('application/json');
      const body = JSON.parse(opts.body);
      expect(typeof body.state).toBe('string');
      expect(body.state).toMatch(/^[0-9a-f]{64}$/);

      expect(mockedOpenAuth).toHaveBeenCalledTimes(1);
      // Verify first arg is the authorize URL and second is the app callback
      const callArgs = mockedOpenAuth.mock.calls[0];
      expect(callArgs[0]).toContain(OAUTH.AUTH_ENDPOINT);
      expect(callArgs[1]).toBe(`${OAUTH.APP_SCHEME}://oauth/callback`);
    });

    it('throws when fetch returns non-ok (proxy state registration failure)', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;
      await expect(startOAuthFlow()).rejects.toThrow(/register OAuth state/i);
      expect(mockedOpenAuth).not.toHaveBeenCalled();
    });

    it('propagates network errors from fetch', async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('network down')) as unknown as typeof fetch;
      await expect(startOAuthFlow()).rejects.toThrow('network down');
      expect(mockedOpenAuth).not.toHaveBeenCalled();
    });

    it('returns the result from WebBrowser.openAuthSessionAsync', async () => {
      const result = { type: 'success', url: 'veloq://oauth/callback?x=1' } as const;
      mockedOpenAuth.mockResolvedValue(result as WebBrowser.WebBrowserAuthSessionResult);
      const actual = await startOAuthFlow();
      expect(actual).toEqual(result);
    });
  });

  describe('parseCallbackUrl()', () => {
    it('returns null for a URL with no query params', () => {
      const result = parseCallbackUrl('veloq://oauth/callback');
      expect(result).toBeNull();
    });

    it('parses success URL with all required fields', () => {
      const url =
        'veloq://oauth/callback?success=true&access_token=abc123&athlete_id=i12345&token_type=Bearer&scope=ACTIVITY%3AREAD&athlete_name=Jane+Doe&state=statexyz';
      const result = parseCallbackUrl(url);
      expect(result).not.toBeNull();
      expect(result!.access_token).toBe('abc123');
      expect(result!.athlete_id).toBe('i12345');
      expect(result!.token_type).toBe('Bearer');
      expect(result!.scope).toBe('ACTIVITY:READ');
      expect(result!.state).toBe('statexyz');
    });

    it('applies defaults when optional fields are missing', () => {
      const url = 'veloq://oauth/callback?success=true&access_token=tok&athlete_id=iABC';
      const result = parseCallbackUrl(url);
      expect(result).not.toBeNull();
      expect(result!.token_type).toBe('Bearer');
      expect(result!.scope).toBe('');
      expect(result!.athlete_name).toBe('');
      expect(result!.state).toBeUndefined();
    });

    it('throws on explicit error response (success=false)', () => {
      const url = 'veloq://oauth/callback?success=false&error=access_denied';
      expect(() => parseCallbackUrl(url)).toThrow('access_denied');
    });

    it('throws on error response without description', () => {
      const url = 'veloq://oauth/callback?success=false';
      expect(() => parseCallbackUrl(url)).toThrow(/OAuth failed/);
    });

    it('throws when error param is present', () => {
      const url = 'veloq://oauth/callback?error=invalid_request';
      expect(() => parseCallbackUrl(url)).toThrow('invalid_request');
    });

    it('returns null when success=true but access_token is missing', () => {
      const url = 'veloq://oauth/callback?success=true&athlete_id=iABC';
      const result = parseCallbackUrl(url);
      expect(result).toBeNull();
    });

    it('returns null when success=true but athlete_id is missing', () => {
      const url = 'veloq://oauth/callback?success=true&access_token=tok';
      const result = parseCallbackUrl(url);
      expect(result).toBeNull();
    });
  });

  describe('validateState()', () => {
    it('returns false when no state has been generated', () => {
      // Ensure state is cleared
      validateState('dummy'); // this returns false AND clears anyway
      expect(validateState('anything')).toBe(false);
    });

    it('returns true when received state matches generated state', async () => {
      mockedOpenAuth.mockResolvedValue({
        type: 'dismiss',
      } as WebBrowser.WebBrowserAuthSessionResult);
      await startOAuthFlow();

      // Extract the state from the fetch body (real state used)
      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      const state = body.state;

      expect(validateState(state)).toBe(true);
    });

    it('returns false when received state does not match', async () => {
      mockedOpenAuth.mockResolvedValue({
        type: 'dismiss',
      } as WebBrowser.WebBrowserAuthSessionResult);
      await startOAuthFlow();
      expect(validateState('wrong-state')).toBe(false);
    });

    it('is single-use: second call returns false even with correct state', async () => {
      mockedOpenAuth.mockResolvedValue({
        type: 'dismiss',
      } as WebBrowser.WebBrowserAuthSessionResult);
      await startOAuthFlow();

      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      const state = body.state;
      expect(validateState(state)).toBe(true);
      // State is cleared after validation — calling again returns false
      expect(validateState(state)).toBe(false);
    });
  });

  describe('handleOAuthCallback()', () => {
    it('throws when callback URL is malformed / has no token data', () => {
      expect(() => handleOAuthCallback('veloq://oauth/callback')).toThrow(/missing token data/);
    });

    it('throws when state parameter is missing from success payload', async () => {
      mockedOpenAuth.mockResolvedValue({
        type: 'dismiss',
      } as WebBrowser.WebBrowserAuthSessionResult);
      await startOAuthFlow();

      const url = 'veloq://oauth/callback?success=true&access_token=tok&athlete_id=iABC';
      expect(() => handleOAuthCallback(url)).toThrow(/missing state parameter/);
    });

    it('throws when state param does not match generated state (CSRF)', async () => {
      mockedOpenAuth.mockResolvedValue({
        type: 'dismiss',
      } as WebBrowser.WebBrowserAuthSessionResult);
      await startOAuthFlow();

      const url =
        'veloq://oauth/callback?success=true&access_token=tok&athlete_id=iABC&state=not-the-state';
      expect(() => handleOAuthCallback(url)).toThrow(/state validation failed/);
    });

    it('returns token response when state matches', async () => {
      mockedOpenAuth.mockResolvedValue({
        type: 'dismiss',
      } as WebBrowser.WebBrowserAuthSessionResult);
      await startOAuthFlow();

      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      const state = body.state;

      const url = `veloq://oauth/callback?success=true&access_token=good-token&athlete_id=i99999&state=${state}&athlete_name=Jane`;
      const result = handleOAuthCallback(url);
      expect(result.access_token).toBe('good-token');
      expect(result.athlete_id).toBe('i99999');
      expect(result.athlete_name).toBe('Jane');
      expect(result.state).toBe(state);
    });

    it('propagates parseCallbackUrl errors (OAuth-level failure)', () => {
      const url = 'veloq://oauth/callback?success=false&error=consent_denied';
      expect(() => handleOAuthCallback(url)).toThrow('consent_denied');
    });
  });
});
