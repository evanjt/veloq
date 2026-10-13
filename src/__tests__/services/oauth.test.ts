/**
 * OAuth service tests
 *
 * Covers CSRF state generation, authorization URL construction,
 * state registration with proxy, callback parsing, and validation.
 *
 * The OAuth flow uses a proxy (Cloudflare Worker) that holds the
 * client_secret - the proxy exchanges the code for a token, then redirects back
 * to the app with a one-time code the app redeems over HTTPS with its PKCE
 * verifier. The token is never in the redirect URL, because that URL reaches any
 * app registering the `veloq` scheme.
 */

// Mock expo-crypto: deterministic getRandomBytes for state generation
import { createHash } from 'node:crypto';

import * as WebBrowser from 'expo-web-browser';
import {
  buildAuthorizationUrl,
  startOAuthFlow,
  classifyAuthResult,
  parseCallbackUrl,
  validateState,
  handleOAuthCallback,
} from '@/features/auth/lib/oauth';
import { OAUTH } from '@/features/auth/constants';

jest.mock('expo-crypto', () => ({
  ...jest.requireActual('expo-crypto'),
  getRandomBytes: jest.fn((length: number) => {
    // Return deterministic bytes (0x00, 0x11, 0x22, ...) for reproducible state
    const arr = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
      arr[i] = i * 0x11;
    }
    return arr;
  }),
  // The challenge is the real SHA-256 so the assertions below compare against
  // what the proxy will compute from the same verifier.
  // A jest.mock factory may not close over an import, and WebCrypto is one of
  // the globals it is allowed to reach.
  digestStringAsync: jest.fn(async (_algorithm: string, data: string) => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
    return btoa(String.fromCharCode(...new Uint8Array(digest)));
  }),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { BASE64: 'base64' },
}));

// The keychain outlives the process and module memory does not, so a flow
// started in one module instance and completed in another is a process death.
const mockKeychain = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  ...jest.requireActual('expo-secure-store'),
  getItemAsync: jest.fn(async (key: string) => mockKeychain.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockKeychain.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockKeychain.delete(key);
  }),
}));

// Mock expo-web-browser: stub openAuthSessionAsync
jest.mock('expo-web-browser', () => ({
  ...jest.requireActual('expo-web-browser'),
  openAuthSessionAsync: jest.fn(),
}));

// Mock expo-linking: use a real-ish parse implementation that reads query params,
// and keep the `url` listeners so a test can deliver a deep link.
const mockUrlListeners = new Set<(event: { url: string }) => void>();
jest.mock('expo-linking', () => ({
  ...jest.requireActual('expo-linking'),
  addEventListener: jest.fn((_type: string, listener: (event: { url: string }) => void) => {
    mockUrlListeners.add(listener);
    return { remove: () => mockUrlListeners.delete(listener) };
  }),
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

const mockedOpenAuth = WebBrowser.openAuthSessionAsync as jest.MockedFunction<
  typeof WebBrowser.openAuthSessionAsync
>;

// fetch is used for state registration with the proxy
const originalFetch = global.fetch;

/** Start a flow and resolve once the browser is in front, which never returns. */
function browserOpenedBy(oauth: typeof import('@/features/auth/lib/oauth')): Promise<void> {
  return new Promise((opened) => {
    mockedOpenAuth.mockImplementationOnce(() => {
      opened();
      return new Promise(() => {});
    });
    void oauth.startOAuthFlow();
  });
}

/** Deliver a deep link to every `url` listener, as Android does when the redirect lands. */
function deliverLink(url: string): void {
  mockUrlListeners.forEach((listener) => listener({ url }));
}

describe('OAuth service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockKeychain.clear();
    // Reset global fetch to a passing stub by default
    global.fetch = jest.fn().mockResolvedValue({ ok: true }) as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  describe('buildAuthorizationUrl()', () => {
    afterEach(async () => {
      // validateState spends whatever flow is in progress.
      await validateState('anything');
    });

    it('throws if oauth state has not been initialised', () => {
      // Fresh module-level state is null; calling buildAuthorizationUrl
      // before startOAuthFlow must throw
      expect(() => buildAuthorizationUrl()).toThrow(/state not initialised/i);
    });

    it('produces a URL containing client_id, redirect_uri, scope, and state when state is set', async () => {
      mockedOpenAuth.mockResolvedValue({
        type: 'cancel',
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

    it('returns the classified browser result', async () => {
      const result = { type: 'success', url: 'veloq://oauth/callback?x=1' } as const;
      mockedOpenAuth.mockResolvedValue(result as WebBrowser.WebBrowserAuthSessionResult);
      const actual = await startOAuthFlow();
      expect(actual).toEqual({ outcome: 'success', url: 'veloq://oauth/callback?x=1' });
    });

    it('reports a closed browser tab as cancelled', async () => {
      mockedOpenAuth.mockResolvedValue({ type: WebBrowser.WebBrowserResultType.DISMISS });
      expect(await startOAuthFlow()).toEqual({ outcome: 'cancelled' });
    });
  });

  describe('a redirect that races the browser closing on Android', () => {
    const GRACE_MS = 1000;

    beforeEach(() => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] });
    });

    afterEach(async () => {
      jest.useRealTimers();
      expect(mockUrlListeners.size).toBe(0);
      await validateState('anything');
    });

    function registeredState(): string {
      return JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body).state;
    }

    function redirectFor(state: string): string {
      return `${OAUTH.APP_SCHEME}://oauth/callback?success=true&code=onetime&state=${state}`;
    }

    /**
     * Settle the flow, moving the fake clock on in steps until it does. The
     * challenge is hashed on a real thread first, so the clock only starts
     * once the browser has been opened.
     */
    async function settle<T>(flow: Promise<T>, totalMs: number): Promise<T> {
      let done = false;
      const mark = () => {
        done = true;
      };
      flow.then(mark, mark);
      while (mockedOpenAuth.mock.calls.length === 0 && !done) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      for (let elapsed = 0; elapsed <= totalMs && !done; elapsed += 50) {
        await jest.advanceTimersByTimeAsync(50);
      }
      return flow;
    }

    it('completes when the redirect lands before the browser reports dismiss', async () => {
      let redirect = '';
      mockedOpenAuth.mockImplementationOnce(async () => {
        redirect = redirectFor(registeredState());
        deliverLink(redirect);
        return { type: WebBrowser.WebBrowserResultType.DISMISS };
      });

      expect(await settle(startOAuthFlow(), 0)).toEqual({ outcome: 'success', url: redirect });
    });

    it('completes when the redirect lands 200 ms after the browser reports dismiss', async () => {
      let redirect = '';
      mockedOpenAuth.mockImplementationOnce(async () => {
        redirect = redirectFor(registeredState());
        setTimeout(() => deliverLink(redirect), 200);
        return { type: WebBrowser.WebBrowserResultType.DISMISS };
      });

      expect(await settle(startOAuthFlow(), GRACE_MS)).toEqual({
        outcome: 'success',
        url: redirect,
      });
    });

    it('is cancelled when only a redirect for another flow lands', async () => {
      mockedOpenAuth.mockImplementationOnce(async () => {
        deliverLink(redirectFor('another-flow'));
        setTimeout(() => deliverLink(redirectFor('yet-another-flow')), 200);
        return { type: WebBrowser.WebBrowserResultType.DISMISS };
      });

      expect(await settle(startOAuthFlow(), GRACE_MS * 2)).toEqual({ outcome: 'cancelled' });
    });

    it('ignores a link to another route carrying this flow state', async () => {
      mockedOpenAuth.mockImplementationOnce(async () => {
        deliverLink(`${OAUTH.APP_SCHEME}://settings?state=${registeredState()}`);
        return { type: WebBrowser.WebBrowserResultType.DISMISS };
      });

      expect(await settle(startOAuthFlow(), GRACE_MS * 2)).toEqual({ outcome: 'cancelled' });
    });

    it('is cancelled when no redirect lands within the grace', async () => {
      let browserClosed!: () => void;
      const closed = new Promise<void>((resolve) => (browserClosed = resolve));
      mockedOpenAuth.mockImplementationOnce(async () => {
        const redirect = redirectFor(registeredState());
        setTimeout(() => deliverLink(redirect), GRACE_MS + 200);
        browserClosed();
        return { type: WebBrowser.WebBrowserResultType.DISMISS };
      });

      let outcome: unknown;
      void startOAuthFlow().then((result) => (outcome = result));
      await closed;
      await jest.advanceTimersByTimeAsync(GRACE_MS - 50);
      expect(outcome).toBeUndefined();
      await jest.advanceTimersByTimeAsync(100);
      expect(outcome).toEqual({ outcome: 'cancelled' });
    });

    it('takes a redirect that landed before an iOS cancel without waiting', async () => {
      let redirect = '';
      mockedOpenAuth.mockImplementationOnce(async () => {
        redirect = redirectFor(registeredState());
        deliverLink(redirect);
        return { type: WebBrowser.WebBrowserResultType.CANCEL };
      });

      expect(await settle(startOAuthFlow(), 0)).toEqual({ outcome: 'success', url: redirect });
    });

    it('returns a success unchanged and without waiting', async () => {
      const url = `${OAUTH.APP_SCHEME}://oauth/callback?success=true&code=from-browser&state=s`;
      mockedOpenAuth.mockImplementationOnce(async () => {
        deliverLink(redirectFor(registeredState()));
        return { type: 'success', url };
      });

      expect(await settle(startOAuthFlow(), 0)).toEqual({ outcome: 'success', url });
    });

    it('stops listening when opening the browser throws', async () => {
      mockedOpenAuth.mockRejectedValueOnce(new Error('no browser'));

      await expect(settle(startOAuthFlow(), 0)).rejects.toThrow('no browser');
    });

    it('listens while the browser is in front', async () => {
      let listening = 0;
      mockedOpenAuth.mockImplementationOnce(async () => {
        listening = mockUrlListeners.size;
        return { type: 'success', url: redirectFor('s') };
      });

      await settle(startOAuthFlow(), 0);
      expect(listening).toBe(1);
    });
  });

  describe('classifyAuthResult()', () => {
    it('passes a success on with its URL', () => {
      expect(classifyAuthResult({ type: 'success', url: 'veloq://oauth/callback?code=c' })).toEqual(
        { outcome: 'success', url: 'veloq://oauth/callback?code=c' }
      );
    });

    it.each([WebBrowser.WebBrowserResultType.CANCEL, WebBrowser.WebBrowserResultType.DISMISS])(
      'reads %s as the athlete cancelling',
      (type) => {
        expect(classifyAuthResult({ type })).toEqual({ outcome: 'cancelled' });
      }
    );

    it.each([WebBrowser.WebBrowserResultType.LOCKED, WebBrowser.WebBrowserResultType.OPENED])(
      'reads %s as a failure',
      (type) => {
        expect(classifyAuthResult({ type })).toEqual({ outcome: 'failed' });
      }
    );

    it('reads a success with no URL as a failure', () => {
      expect(
        classifyAuthResult({ type: 'success', url: '' } as WebBrowser.WebBrowserAuthSessionResult)
      ).toEqual({ outcome: 'failed' });
    });
  });

  describe('parseCallbackUrl()', () => {
    it('returns null for a URL with no query params', () => {
      const result = parseCallbackUrl('veloq://oauth/callback');
      expect(result).toBeNull();
    });

    it('reads the one-time code the proxy redirects with', () => {
      const url = 'veloq://oauth/callback?success=true&code=onetimecode&state=statexyz';
      const result = parseCallbackUrl(url);
      expect(result).toEqual({ code: 'onetimecode', state: 'statexyz' });
      expect(result).not.toHaveProperty('token');
    });

    it('parses a token URL from a proxy deployed before the code existed', () => {
      const url =
        'veloq://oauth/callback?success=true&access_token=abc123&athlete_id=i12345&token_type=Bearer&scope=ACTIVITY%3AREAD&athlete_name=Jane+Doe&state=statexyz';
      const result = parseCallbackUrl(url);
      expect(result).not.toBeNull();
      expect(result!.token!.access_token).toBe('abc123');
      expect(result!.token!.athlete_id).toBe('i12345');
      expect(result!.token!.token_type).toBe('Bearer');
      expect(result!.token!.scope).toBe('ACTIVITY:READ');
      expect(result!.state).toBe('statexyz');
    });

    it('applies defaults when optional fields are missing', () => {
      const url = 'veloq://oauth/callback?success=true&access_token=tok&athlete_id=iABC';
      const result = parseCallbackUrl(url);
      expect(result).not.toBeNull();
      expect(result!.token!.token_type).toBe('Bearer');
      expect(result!.token!.scope).toBe('');
      expect(result!.token!.athlete_name).toBe('');
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
    it('returns false when no state has been generated', async () => {
      // Ensure state is cleared
      await validateState('dummy'); // this returns false AND clears anyway
      expect(await validateState('anything')).toBe(false);
    });

    it('returns true when received state matches generated state', async () => {
      mockedOpenAuth.mockResolvedValue({
        type: 'cancel',
      } as WebBrowser.WebBrowserAuthSessionResult);
      await startOAuthFlow();

      // Extract the state from the fetch body (real state used)
      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      const state = body.state;

      expect(await validateState(state)).toBe(true);
    });

    it('returns false when received state does not match', async () => {
      mockedOpenAuth.mockResolvedValue({
        type: 'cancel',
      } as WebBrowser.WebBrowserAuthSessionResult);
      await startOAuthFlow();
      expect(await validateState('wrong-state')).toBe(false);
    });

    it('is single-use: second call returns false even with correct state', async () => {
      mockedOpenAuth.mockResolvedValue({
        type: 'cancel',
      } as WebBrowser.WebBrowserAuthSessionResult);
      await startOAuthFlow();

      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      const state = body.state;
      expect(await validateState(state)).toBe(true);
      // State is cleared after validation - calling again returns false
      expect(await validateState(state)).toBe(false);
    });
  });

  describe('handleOAuthCallback()', () => {
    /** Start a flow and hand back the state and challenge it registered. */
    async function startedFlow() {
      mockedOpenAuth.mockResolvedValue({
        type: 'cancel',
      } as WebBrowser.WebBrowserAuthSessionResult);
      await startOAuthFlow();
      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      return { state: body.state as string, challenge: body.code_challenge as string };
    }

    it('throws when callback URL is malformed / has no token data', async () => {
      await expect(handleOAuthCallback('veloq://oauth/callback')).rejects.toThrow(
        /missing token data/
      );
    });

    it('throws when state parameter is missing from success payload', async () => {
      await startedFlow();

      const url = 'veloq://oauth/callback?success=true&access_token=tok&athlete_id=iABC';
      await expect(handleOAuthCallback(url)).rejects.toThrow(/missing state parameter/);
    });

    it('throws when state param does not match generated state (CSRF)', async () => {
      await startedFlow();

      const url =
        'veloq://oauth/callback?success=true&access_token=tok&athlete_id=iABC&state=not-the-state';
      await expect(handleOAuthCallback(url)).rejects.toThrow(/state validation failed/);
    });

    it('redeems the code at the proxy, presenting the verifier', async () => {
      const { state } = await startedFlow();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          access_token: 'good-token',
          token_type: 'Bearer',
          scope: 'ACTIVITY:READ',
          athlete_id: 'i99999',
          athlete_name: 'Jane',
        }),
      });

      const result = await handleOAuthCallback(
        `veloq://oauth/callback?success=true&code=onetime&state=${state}`
      );

      const [url, opts] = (global.fetch as jest.Mock).mock.calls[1];
      expect(url).toBe(`${OAUTH.PROXY_URL}/oauth/token`);
      expect(opts.method).toBe('POST');
      const sent = JSON.parse(opts.body);
      expect(sent.code).toBe('onetime');
      expect(sent.code_verifier).toMatch(/^[0-9a-f]{128}$/);
      expect(result.access_token).toBe('good-token');
      expect(result.athlete_id).toBe('i99999');
      expect(result.athlete_name).toBe('Jane');
      expect(result.scope).toBe('ACTIVITY:READ');
    });

    it('sends the verifier the challenge it registered was made from', async () => {
      const { state, challenge } = await startedFlow();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok', athlete_id: 'i1' }),
      });

      await handleOAuthCallback(`veloq://oauth/callback?success=true&code=onetime&state=${state}`);

      const sent = JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body);
      const expected = createHash('sha256')
        .update(sent.code_verifier)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      expect(challenge).toBe(expected);
    });

    it('refuses a second attempt with the same code, the verifier being spent', async () => {
      const { state } = await startedFlow();
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ access_token: 'tok', athlete_id: 'i1' }),
      });
      const url = `veloq://oauth/callback?success=true&code=onetime&state=${state}`;
      await handleOAuthCallback(url);

      // The state is single-use too, so this is the error it reaches first.
      await expect(handleOAuthCallback(url)).rejects.toThrow(/state validation failed/);
    });

    it('throws when the proxy refuses the exchange', async () => {
      const { state } = await startedFlow();
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 400 });

      await expect(
        handleOAuthCallback(`veloq://oauth/callback?success=true&code=onetime&state=${state}`)
      ).rejects.toThrow(/could not be redeemed/);
    });

    it('throws when the exchange answers without a token', async () => {
      const { state } = await startedFlow();
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      });

      await expect(
        handleOAuthCallback(`veloq://oauth/callback?success=true&code=onetime&state=${state}`)
      ).rejects.toThrow(/no token/);
    });

    it('takes the token straight from a proxy that has not been updated', async () => {
      const { state } = await startedFlow();

      const result = await handleOAuthCallback(
        `veloq://oauth/callback?success=true&access_token=good-token&athlete_id=i99999&state=${state}&athlete_name=Jane`
      );

      expect(result.access_token).toBe('good-token');
      expect(result.athlete_id).toBe('i99999');
      // Only the state registration; nothing was redeemed.
      expect((global.fetch as jest.Mock).mock.calls).toHaveLength(1);
    });

    it('propagates parseCallbackUrl errors (OAuth-level failure)', async () => {
      const url = 'veloq://oauth/callback?success=false&error=consent_denied';
      await expect(handleOAuthCallback(url)).rejects.toThrow('consent_denied');
    });
  });

  describe('a flow interrupted by process death', () => {
    type OAuthModule = typeof import('@/features/auth/lib/oauth');

    /** A fresh module instance: what a recreated process loads. */
    function freshProcess(): OAuthModule {
      let loaded: OAuthModule | undefined;
      jest.isolateModules(() => {
        loaded = require('@/features/auth/lib/oauth');
      });
      return loaded!;
    }

    /** Start a flow in a process that then dies, handing back what it registered. */
    async function startInDyingProcess() {
      await browserOpenedBy(freshProcess());
      const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      return { state: body.state as string, challenge: body.code_challenge as string };
    }

    function redeemsTo(token: Record<string, string>) {
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => token });
    }

    let startedAt: number;
    beforeEach(() => {
      startedAt = Date.now();
    });
    afterEach(() => {
      jest.setSystemTime(startedAt);
    });

    it('completes in the recreated process with the verifier the challenge was made from', async () => {
      const { state, challenge } = await startInDyingProcess();
      redeemsTo({ access_token: 'resumed-token', athlete_id: 'i42', athlete_name: 'Ana' });

      const result = await freshProcess().handleOAuthCallback(
        `veloq://oauth/callback?success=true&code=onetime&state=${state}`
      );

      expect(result.access_token).toBe('resumed-token');
      expect(result.athlete_id).toBe('i42');
      const sent = JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body);
      const expected = createHash('sha256')
        .update(sent.code_verifier)
        .digest('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      expect(challenge).toBe(expected);
    });

    it('leaves nothing stored once the flow completes', async () => {
      const { state } = await startInDyingProcess();
      expect(mockKeychain.size).toBe(1);
      redeemsTo({ access_token: 'tok', athlete_id: 'i1' });

      await freshProcess().handleOAuthCallback(
        `veloq://oauth/callback?success=true&code=onetime&state=${state}`
      );

      expect(mockKeychain.size).toBe(0);
    });

    it('leaves nothing stored when the redemption fails', async () => {
      const { state } = await startInDyingProcess();
      (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 400 });

      await expect(
        freshProcess().handleOAuthCallback(
          `veloq://oauth/callback?success=true&code=onetime&state=${state}`
        )
      ).rejects.toThrow(/could not be redeemed/);
      expect(mockKeychain.size).toBe(0);
    });

    it('leaves nothing stored when the browser comes back with a refusal', async () => {
      const { state } = await startInDyingProcess();
      const oauth = freshProcess();

      await expect(
        oauth.handleOAuthCallback(
          `veloq://oauth/callback?success=false&error=access_denied&state=${state}`
        )
      ).rejects.toThrow('access_denied');
      expect(mockKeychain.size).toBe(0);
    });

    it('leaves nothing stored when the proxy refuses to register the flow', async () => {
      global.fetch = jest.fn().mockResolvedValue({ ok: false }) as unknown as typeof fetch;

      await expect(freshProcess().startOAuthFlow()).rejects.toThrow(/register OAuth state/i);
      expect(mockKeychain.size).toBe(0);
    });

    it('refuses a flow older than ten minutes and drops it', async () => {
      const { state } = await startInDyingProcess();
      jest.setSystemTime(startedAt + 10 * 60 * 1000 + 1);
      const oauth = freshProcess();

      const attempt = oauth.handleOAuthCallback(
        `veloq://oauth/callback?success=true&code=onetime&state=${state}`
      );

      await expect(attempt).rejects.toThrow(/no sign-in in progress/);
      await attempt.catch((err) =>
        expect(oauth.oauthFailureKey(err)).toBe('login.oauthInterrupted')
      );
      expect(mockKeychain.size).toBe(0);
      // Only the registration: an expired code is never presented.
      expect((global.fetch as jest.Mock).mock.calls).toHaveLength(1);
    });

    it('still completes a flow at exactly ten minutes', async () => {
      const { state } = await startInDyingProcess();
      jest.setSystemTime(startedAt + 10 * 60 * 1000);
      redeemsTo({ access_token: 'tok', athlete_id: 'i1' });

      const result = await freshProcess().handleOAuthCallback(
        `veloq://oauth/callback?success=true&code=onetime&state=${state}`
      );

      expect(result.access_token).toBe('tok');
    });

    it('refuses an expired flow in the process that started it too', async () => {
      mockedOpenAuth.mockResolvedValue({
        type: 'cancel',
      } as WebBrowser.WebBrowserAuthSessionResult);
      const oauth = freshProcess();
      await oauth.startOAuthFlow();
      const { state } = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
      jest.setSystemTime(startedAt + 11 * 60 * 1000);

      await expect(
        oauth.handleOAuthCallback(`veloq://oauth/callback?success=true&code=onetime&state=${state}`)
      ).rejects.toThrow(/no sign-in in progress/);
      expect(mockKeychain.size).toBe(0);
    });

    it('names the interruption when a callback arrives with nothing stored', async () => {
      const oauth = freshProcess();

      const attempt = oauth.handleOAuthCallback(
        'veloq://oauth/callback?success=true&code=onetime&state=from-a-lost-flow'
      );

      await expect(attempt).rejects.toThrow(/no sign-in in progress/);
      await attempt.catch((err) =>
        expect(oauth.oauthFailureKey(err)).toBe('login.oauthInterrupted')
      );
    });

    it('refuses a stored flow whose state the callback does not carry', async () => {
      await startInDyingProcess();

      await expect(
        freshProcess().handleOAuthCallback(
          'veloq://oauth/callback?success=true&code=onetime&state=not-the-state'
        )
      ).rejects.toThrow(/state validation failed/);
      expect(mockKeychain.size).toBe(0);
    });

    it('treats an unreadable keychain entry as nothing stored', async () => {
      const { state } = await startInDyingProcess();
      const [key] = [...mockKeychain.keys()];
      mockKeychain.set(key, '{not json');

      await expect(
        freshProcess().handleOAuthCallback(
          `veloq://oauth/callback?success=true&code=onetime&state=${state}`
        )
      ).rejects.toThrow(/no sign-in in progress/);
      expect(mockKeychain.size).toBe(0);
    });
  });

  describe('a callback the app was relaunched by', () => {
    type OAuthModule = typeof import('@/features/auth/lib/oauth');

    function freshProcess(): OAuthModule {
      let loaded: OAuthModule | undefined;
      jest.isolateModules(() => {
        loaded = require('@/features/auth/lib/oauth');
      });
      return loaded!;
    }

    it('is left to the sign-in that started it when this process opened the browser', async () => {
      const oauth = freshProcess();
      await browserOpenedBy(oauth);
      const { state } = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);

      expect(
        oauth.holdInterruptedCallback(`veloq://oauth/callback?success=true&code=c&state=${state}`)
      ).toBe(false);
      expect(oauth.takeInterruptedCallback()).toBeNull();
    });

    it('is held once for the sign-in screen when another process opened the browser', () => {
      const oauth = freshProcess();
      const heard = jest.fn();
      const unsubscribe = oauth.onInterruptedCallback(heard);
      const url = 'veloq://oauth/callback?success=true&code=c&state=s';

      expect(oauth.holdInterruptedCallback(url)).toBe(true);
      expect(heard).toHaveBeenCalledTimes(1);
      expect(oauth.takeInterruptedCallback()).toBe(url);
      expect(oauth.takeInterruptedCallback()).toBeNull();
      unsubscribe();
    });

    it('holds nothing for a bare callback link', () => {
      const oauth = freshProcess();
      expect(oauth.holdInterruptedCallback('veloq://oauth/callback')).toBe(false);
      expect(oauth.takeInterruptedCallback()).toBeNull();
    });

    it('rebuilds the link from the route parameters it arrived with', () => {
      const oauth = freshProcess();
      expect(
        oauth.callbackUrlFromParams({ success: 'true', code: 'a b', state: ['s1', 's2'] })
      ).toBe(`${OAUTH.APP_SCHEME}://oauth/callback?success=true&code=a+b&state=s1`);
    });
  });
});
