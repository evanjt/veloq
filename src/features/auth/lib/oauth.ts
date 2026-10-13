import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { OAUTH } from '@/features/auth/constants';
import { NET_DEADLINE_MS, fetchWithDeadline, isFetchTimeout } from '@/shared/net/fetchWithDeadline';

/**
 * The proxy answered, and not with success. Distinct from a request that never
 * reached it, which is the network's failure rather than the proxy's.
 */
export class OAuthProxyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OAuthProxyError';
  }
}

class OAuthFlowError extends Error {
  constructor(
    message: string,
    readonly key: OAuthFailureKey
  ) {
    super(message);
    this.name = 'OAuthFlowError';
  }
}

/** A sign-in failure the error slot can name in the athlete's language. */
export type OAuthFailureKey =
  | 'login.oauthFailed'
  | 'login.oauthStateValidationFailed'
  | 'login.oauthUnreachable'
  | 'login.oauthProxyRefused'
  | 'login.oauthInvalidCallback'
  | 'login.oauthAccessDenied'
  | 'login.oauthCodeExchangeFailed'
  | 'login.oauthInterrupted';

/**
 * The translation key for a sign-in failure the athlete can act on.
 *
 * A request that never reached the proxy rejects with a `TypeError` from
 * `fetch`, or with a `FetchTimeoutError` at the deadline. Both carry English
 * text written for a developer, so neither message is ever shown.
 */
export function oauthFailureKey(error: unknown): OAuthFailureKey {
  if (!(error instanceof Error)) return 'login.oauthFailed';
  if (error instanceof OAuthFlowError) return error.key;
  if (
    error.message.includes('state validation failed') ||
    error.message.includes('missing state parameter')
  ) {
    return 'login.oauthStateValidationFailed';
  }
  if (isFetchTimeout(error) || error instanceof TypeError) return 'login.oauthUnreachable';
  if (error instanceof OAuthProxyError) return 'login.oauthProxyRefused';
  return 'login.oauthFailed';
}

/**
 * How long a started sign-in waits for its redirect. Long enough to type a
 * password and approve, short enough that a verifier left by an abandoned
 * browser does not outlive the attempt.
 */
export const OAUTH_FLOW_TTL_MS = 10 * 60 * 1000;

/**
 * The state and PKCE verifier of the sign-in in progress.
 *
 * They are kept in the keychain for the life of the request, as RFC 8252 asks,
 * because Android may kill the app while the browser is in front, and the
 * process the redirect then starts has to complete the flow. The verifier
 * never leaves the device: only its SHA-256 goes to the proxy, and the
 * verifier itself is sent once, over HTTPS, to redeem the code.
 *
 * One flow at a time: starting another replaces it.
 */
interface PendingFlow {
  state: string;
  verifier: string;
  /** Epoch milliseconds the flow was started at. */
  startedAt: number;
}

const PENDING_FLOW_KEY = 'oauth_pending_flow';

/** Read by this app alone, never by an extension, so it needs no shared group. */
const PENDING_FLOW_KEYCHAIN_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

/** This process's copy of the stored flow. */
let pendingFlow: PendingFlow | null = null;

/**
 * Every state this process started a flow with. A redirect carrying one of
 * them is answered by the `openAuthSessionAsync` call that opened the browser,
 * so the callback route leaves it alone.
 */
const statesStartedHere = new Set<string>();

async function savePendingFlow(flow: PendingFlow): Promise<void> {
  pendingFlow = flow;
  statesStartedHere.add(flow.state);
  try {
    await SecureStore.setItemAsync(
      PENDING_FLOW_KEY,
      JSON.stringify(flow),
      PENDING_FLOW_KEYCHAIN_OPTIONS
    );
  } catch {
    // The flow still completes in this process; only a process death loses it.
  }
}

async function clearPendingFlow(): Promise<void> {
  pendingFlow = null;
  try {
    await SecureStore.deleteItemAsync(PENDING_FLOW_KEY, PENDING_FLOW_KEYCHAIN_OPTIONS);
  } catch {
    // An entry that will not delete expires, and the next start replaces it.
  }
}

function asPendingFlow(value: unknown): PendingFlow | null {
  if (typeof value !== 'object' || value === null) return null;
  const { state, verifier, startedAt } = value as Record<string, unknown>;
  if (typeof state !== 'string' || typeof verifier !== 'string') return null;
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return null;
  return { state, verifier, startedAt };
}

async function readStoredFlow(): Promise<PendingFlow | null> {
  try {
    const stored = await SecureStore.getItemAsync(PENDING_FLOW_KEY, PENDING_FLOW_KEYCHAIN_OPTIONS);
    return stored === null ? null : asPendingFlow(JSON.parse(stored));
  } catch {
    return null;
  }
}

/**
 * Take the flow in progress, from this process or from the keychain when the
 * process that started it is gone. Taking spends it, whatever the callback
 * turns out to hold, so a code is never presented twice. Null when there is
 * none, or when it is older than `OAUTH_FLOW_TTL_MS`.
 */
async function takePendingFlow(): Promise<PendingFlow | null> {
  const flow = pendingFlow ?? (await readStoredFlow());
  await clearPendingFlow();
  if (!flow) return null;
  const age = Date.now() - flow.startedAt;
  return age >= 0 && age <= OAUTH_FLOW_TTL_MS ? flow : null;
}

function generateState(): string {
  return randomHex(32);
}

/**
 * A verifier of 64 random bytes as hex, which is 128 characters: the longest
 * RFC 7636 allows, and hex is inside its unreserved set.
 */
function generateVerifier(): string {
  return randomHex(64);
}

function randomHex(byteCount: number): string {
  const array = Crypto.getRandomBytes(byteCount);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Base64url of the SHA-256 of the verifier: RFC 7636's `S256` challenge method. */
async function codeChallengeFor(verifier: string): Promise<string> {
  const base64 = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  athlete_id: string;
  athlete_name: string;
  state?: string | undefined;
}

export function isOAuthConfigured(): boolean {
  return !!OAUTH.CLIENT_ID && !!OAUTH.PROXY_URL;
}

export function getProxyRedirectUri(): string {
  return `${OAUTH.PROXY_URL}/oauth/callback`;
}

/**
 * Build the OAuth authorization URL
 * Redirects to the proxy, which then redirects to the app with the token
 * Note: a flow must have been started before calling this function
 */
export function buildAuthorizationUrl(scopes: readonly string[] = OAUTH.SCOPES): string {
  if (!pendingFlow) {
    throw new Error('OAuth state not initialised. Call startOAuthFlow() instead.');
  }

  // The redirect_uri points to our proxy, not the app directly
  const proxyRedirectUri = getProxyRedirectUri();

  const params = new URLSearchParams({
    client_id: OAUTH.CLIENT_ID,
    redirect_uri: proxyRedirectUri,
    scope: scopes.join(','),
    response_type: 'code',
    state: pendingFlow.state,
  });

  return `${OAUTH.AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * Register the OAuth state with the proxy for CSRF protection
 * This must be called before the OAuth flow starts
 */
async function registerStateWithProxy(state: string, codeChallenge: string): Promise<void> {
  const response = await fetchWithDeadline(
    `${OAUTH.PROXY_URL}/oauth/state`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ state, code_challenge: codeChallenge }),
    },
    NET_DEADLINE_MS.interactive
  );

  if (!response.ok) {
    throw new OAuthProxyError('Failed to register OAuth state with proxy');
  }
}

/**
 * Start the OAuth flow by opening the authorization URL in the browser
 *
 * Flow:
 * 1. App generates state and a PKCE verifier, and registers the state with the
 *    challenge derived from that verifier (CSRF protection, and proof of who
 *    started the flow)
 * 2. App opens browser to intervals.icu/oauth/authorize
 * 3. User logs in and approves
 * 4. intervals.icu redirects to proxy with auth code and state
 * 5. Proxy validates state, exchanges code for token (with client_secret)
 * 6. Proxy redirects to app with a one-time code via deep link
 * 7. App redeems that code over HTTPS, presenting the verifier
 *
 * Step 7 is what the deep link being interceptable costs. Android's
 * `singleTask` launch mode hands the callback URL to any installed app that
 * registers the `veloq` scheme, so the token is never in it.
 */
export async function startOAuthFlow(
  scopes: readonly string[] = OAUTH.SCOPES
): Promise<OAuthFlowResult> {
  if (!isOAuthConfigured()) {
    throw new Error(
      'OAuth is not configured. Set CLIENT_ID and PROXY_URL in src/lib/utils/constants.ts'
    );
  }

  // The verifier stays here and its hash goes to the proxy, so the code the
  // redirect comes back with is redeemable by this app and nothing else.
  const state = generateState();
  const verifier = generateVerifier();
  await savePendingFlow({ state, verifier, startedAt: Date.now() });

  // Register state and challenge with proxy for server-side validation
  try {
    await registerStateWithProxy(state, await codeChallengeFor(verifier));
  } catch (error) {
    await clearPendingFlow();
    throw error;
  }

  const authUrl = buildAuthorizationUrl(scopes);
  const appCallbackUrl = getAppRedirectUri();

  // Open browser for authorization
  // The proxy will redirect back to our app scheme
  const redirect = listenForRedirect(state);
  try {
    const result = await WebBrowser.openAuthSessionAsync(authUrl, appCallbackUrl);
    if (result.type === WebBrowser.WebBrowserResultType.DISMISS) {
      const url = await redirect.within(REDIRECT_GRACE_MS);
      if (url) return { outcome: 'success', url };
    } else if (result.type === WebBrowser.WebBrowserResultType.CANCEL) {
      const url = redirect.taken();
      if (url) return { outcome: 'success', url };
    }
    return classifyAuthResult(result);
  } finally {
    redirect.stop();
  }
}

/**
 * How long a `dismiss` waits for the redirect it may have overtaken. Android
 * has no native auth session: the fallback reports `dismiss` as soon as the app
 * is back in front, and the redirect intent that brought it there can be
 * delivered either side of that.
 */
const REDIRECT_GRACE_MS = 1000;

/**
 * Listen for this flow's redirect as a deep link, so the browser closing first
 * does not lose it. Only a link to the callback route carrying this flow's
 * state is kept.
 */
function listenForRedirect(state: string): {
  taken: () => string | null;
  within: (ms: number) => Promise<string | null>;
  stop: () => void;
} {
  let captured: string | null = null;
  let heard: ((url: string) => void) | null = null;
  const subscription = Linking.addEventListener('url', ({ url }) => {
    if (captured || !isRedirectFor(url, state)) return;
    captured = url;
    heard?.(url);
  });
  return {
    taken: () => captured,
    within: (ms) =>
      new Promise((resolve) => {
        if (captured) {
          resolve(captured);
          return;
        }
        const timer = setTimeout(() => {
          heard = null;
          resolve(null);
        }, ms);
        heard = (url) => {
          clearTimeout(timer);
          heard = null;
          resolve(url);
        };
      }),
    stop: () => subscription.remove(),
  };
}

function isRedirectFor(url: string, state: string): boolean {
  const redirectUri = getAppRedirectUri();
  if (url !== redirectUri && !url.startsWith(`${redirectUri}?`)) return false;
  try {
    return Linking.parse(url).queryParams?.state === state;
  } catch {
    return false;
  }
}

/** How the browser half of a sign-in ended, read the same way by every caller. */
export type OAuthFlowResult =
  | { outcome: 'success'; url: string }
  | { outcome: 'cancelled' }
  | { outcome: 'failed' };

/**
 * Closing the sign-in tab is a cancel the athlete chose, not an error. iOS
 * reports it as `cancel`; Android has no native auth session, and its fallback
 * reports `dismiss` when the app returns to the foreground without a redirect.
 * Anything else, such as `locked` while another session is open, is a failure.
 */
export function classifyAuthResult(
  result: WebBrowser.WebBrowserAuthSessionResult
): OAuthFlowResult {
  if (result.type === 'success') {
    return result.url ? { outcome: 'success', url: result.url } : { outcome: 'failed' };
  }
  if (
    result.type === WebBrowser.WebBrowserResultType.CANCEL ||
    result.type === WebBrowser.WebBrowserResultType.DISMISS
  ) {
    return { outcome: 'cancelled' };
  }
  return { outcome: 'failed' };
}

/**
 * What the proxy redirected back with: a one-time code to redeem, or, from a
 * proxy that has not been updated, the token itself.
 */
export interface OAuthCallback {
  /** The one-time code, redeemed over HTTPS by `redeemCallback`. */
  code?: string | undefined;
  /** The token, when the proxy put it in the URL. */
  token?: OAuthTokenResponse | undefined;
  state?: string | undefined;
}

/**
 * Parse the OAuth callback URL from the proxy.
 *
 * The code path is the one that matters: the URL reaches any app registering
 * the `veloq` scheme, so it carries a code that is worthless without the
 * verifier. The token path is what a proxy deployed before the code existed
 * still sends.
 */
export function parseCallbackUrl(url: string): OAuthCallback | null {
  try {
    const parsed = Linking.parse(url);
    const params = parsed.queryParams;

    if (!params) {
      return null;
    }

    // Check for error response
    if (params.success === 'false' || params.error) {
      const reason = typeof params.error === 'string' ? params.error : 'OAuth failed';
      throw new OAuthFlowError(
        reason,
        reason === 'access_denied' ? 'login.oauthAccessDenied' : 'login.oauthFailed'
      );
    }

    const state = (params.state as string) || undefined;

    if (params.success === 'true' && params.code) {
      return { code: params.code as string, state };
    }

    // Check for success response with all required fields
    if (params.success === 'true' && params.access_token && params.athlete_id) {
      return {
        token: {
          access_token: params.access_token as string,
          token_type: (params.token_type as string) || 'Bearer',
          scope: (params.scope as string) || '',
          athlete_id: params.athlete_id as string,
          athlete_name: (params.athlete_name as string) || '',
          state,
        },
        state,
      };
    }

    return null;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    return null;
  }
}

/**
 * Validate the state parameter from the callback, spending the flow in progress
 * whether it matches or not.
 */
export async function validateState(receivedState: string): Promise<boolean> {
  const flow = await takePendingFlow();
  return flow !== null && flow.state === receivedState;
}

/**
 * Redeem the one-time code for the token, presenting the verifier the challenge
 * was made from. Over HTTPS to the proxy, so nothing on the device sees it.
 */
async function redeemCode(code: string, verifier: string): Promise<OAuthTokenResponse> {
  const response = await fetchWithDeadline(
    `${OAUTH.PROXY_URL}/oauth/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier }),
    },
    NET_DEADLINE_MS.interactive
  );

  if (!response.ok) {
    throw new OAuthProxyError('OAuth code could not be redeemed');
  }

  const body = (await response.json()) as Partial<OAuthTokenResponse> & { success?: boolean };
  if (!body.access_token || !body.athlete_id) {
    throw new OAuthFlowError(
      'OAuth code exchange returned no token',
      'login.oauthCodeExchangeFailed'
    );
  }

  return {
    access_token: body.access_token,
    token_type: body.token_type || 'Bearer',
    scope: body.scope || '',
    athlete_id: body.athlete_id,
    athlete_name: body.athlete_name || '',
  };
}

/**
 * Handle the complete OAuth callback flow.
 *
 * The state is validated here as well as at the proxy, defence in depth against
 * a callback the app did not start. The code is then redeemed over HTTPS: the
 * deep link carries nothing usable on its own, which is the point, so the token
 * only exists once this resolves.
 */
export async function handleOAuthCallback(url: string): Promise<OAuthTokenResponse> {
  // Spent whatever the callback holds: a refusal, a failed redemption or a
  // forged state must not leave the verifier for a second try.
  const flow = await takePendingFlow();
  const callback = parseCallbackUrl(url);

  if (!callback) {
    throw new OAuthFlowError(
      'Invalid OAuth callback URL - missing token data',
      'login.oauthInvalidCallback'
    );
  }

  // Validate state parameter for CSRF protection
  // The state should be present in the callback and match what we generated
  if (!callback.state) {
    throw new OAuthFlowError(
      'OAuth callback missing state parameter - possible CSRF attack',
      'login.oauthStateValidationFailed'
    );
  }

  // Nothing stored, or stored too long ago: the attempt this answers is gone,
  // and the athlete is told to start again rather than shown a security error.
  if (!flow) {
    throw new OAuthFlowError(
      'OAuth state validation failed - no sign-in in progress',
      'login.oauthInterrupted'
    );
  }

  if (callback.state !== flow.state) {
    throw new OAuthFlowError(
      'OAuth state validation failed - possible CSRF attack',
      'login.oauthStateValidationFailed'
    );
  }

  if (callback.code) {
    return redeemCode(callback.code, flow.verifier);
  }

  if (callback.token) {
    return callback.token;
  }

  throw new OAuthFlowError(
    'Invalid OAuth callback URL - missing token data',
    'login.oauthInvalidCallback'
  );
}

/**
 * A redirect that arrived in a process that did not open the browser, waiting
 * for the sign-in screen to complete it. Android may kill the app while the
 * browser is in front, and the redirect then starts a new one.
 */
let interruptedCallback: string | null = null;
const interruptedCallbackListeners = new Set<() => void>();

/**
 * Hold a redirect for the sign-in screen when no `openAuthSessionAsync` in this
 * process is waiting for it. False when this process started the flow it
 * answers, or when the link carries nothing to answer.
 */
export function holdInterruptedCallback(url: string): boolean {
  const params = Linking.parse(url).queryParams ?? {};
  if (Object.keys(params).length === 0) return false;
  const state = params.state;
  if (typeof state === 'string' && statesStartedHere.has(state)) return false;
  interruptedCallback = url;
  interruptedCallbackListeners.forEach((listener) => listener());
  return true;
}

/** The held redirect, once: whoever takes it completes it. */
export function takeInterruptedCallback(): string | null {
  const url = interruptedCallback;
  interruptedCallback = null;
  return url;
}

/** Called each time a redirect is held. Returns the unsubscribe. */
export function onInterruptedCallback(listener: () => void): () => void {
  interruptedCallbackListeners.add(listener);
  return () => {
    interruptedCallbackListeners.delete(listener);
  };
}

/** The redirect URL again, from the query parameters the callback route was opened with. */
export function callbackUrlFromParams(
  params: Record<string, string | string[] | undefined>
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined) query.append(key, first);
  }
  const search = query.toString();
  return search ? `${getAppRedirectUri()}?${search}` : getAppRedirectUri();
}

/**
 * Get the app's OAuth redirect URI (for deep linking setup)
 */
export function getAppRedirectUri(): string {
  return `${OAUTH.APP_SCHEME}://oauth/callback`;
}

// Re-export INTERVALS_URLS from constants for backwards compatibility
export { INTERVALS_URLS } from '@/shared/app/constants';
