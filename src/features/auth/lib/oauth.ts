import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import * as Crypto from 'expo-crypto';

import { OAUTH } from '@/features/auth/constants';

/**
 * Module-level state for CSRF protection during OAuth flow.
 *
 * This is a global mutable variable intentionally - the OAuth flow requires
 * generating a state before redirect and validating it on callback. The state
 * must persist across the browser redirect cycle.
 *
 * Limitations:
 * - Only one OAuth flow can be active at a time (acceptable for mobile apps)
 * - State is lost on app restart (OAuth must be restarted)
 * - Not suitable for server-side rendering or concurrent auth flows
 *
 * For more complex scenarios, consider storing state in SecureStore with
 * a timeout for expiration.
 */
let oauthState: string | null = null;

/**
 * The PKCE verifier for the flow in progress, held for exactly as long as the
 * state is. It never leaves the device: only its SHA-256 goes to the proxy, and
 * the verifier itself is sent once, over HTTPS, to redeem the code.
 */
let oauthVerifier: string | null = null;

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
  state?: string;
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
 * Note: oauthState must be set before calling this function
 */
export function buildAuthorizationUrl(scopes: readonly string[] = OAUTH.SCOPES): string {
  if (!oauthState) {
    throw new Error('OAuth state not initialized. Call startOAuthFlow() instead.');
  }

  // The redirect_uri points to our proxy, not the app directly
  const proxyRedirectUri = getProxyRedirectUri();

  const params = new URLSearchParams({
    client_id: OAUTH.CLIENT_ID,
    redirect_uri: proxyRedirectUri,
    scope: scopes.join(','),
    response_type: 'code',
    state: oauthState,
  });

  return `${OAUTH.AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * Register the OAuth state with the proxy for CSRF protection
 * This must be called before the OAuth flow starts
 */
async function registerStateWithProxy(state: string, codeChallenge: string): Promise<void> {
  const response = await fetch(`${OAUTH.PROXY_URL}/oauth/state`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ state, code_challenge: codeChallenge }),
  });

  if (!response.ok) {
    throw new Error('Failed to register OAuth state with proxy');
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
): Promise<WebBrowser.WebBrowserAuthSessionResult> {
  if (!isOAuthConfigured()) {
    throw new Error(
      'OAuth is not configured. Set CLIENT_ID and PROXY_URL in src/lib/utils/constants.ts'
    );
  }

  // Generate state and register with proxy before building URL
  const state = generateState();
  oauthState = state;

  // The verifier stays here and its hash goes to the proxy, so the code the
  // redirect comes back with is redeemable by this app and nothing else.
  const verifier = generateVerifier();
  oauthVerifier = verifier;

  // Register state and challenge with proxy for server-side validation
  await registerStateWithProxy(state, await codeChallengeFor(verifier));

  const authUrl = buildAuthorizationUrl(scopes);
  const appCallbackUrl = `${OAUTH.APP_SCHEME}://oauth/callback`;

  // Open browser for authorization
  // The proxy will redirect back to our app scheme
  const result = await WebBrowser.openAuthSessionAsync(authUrl, appCallbackUrl);

  return result;
}

/**
 * What the proxy redirected back with: a one-time code to redeem, or, from a
 * proxy that has not been updated, the token itself.
 */
export interface OAuthCallback {
  /** The one-time code, redeemed over HTTPS by `redeemCallback`. */
  code?: string;
  /** The token, when the proxy put it in the URL. */
  token?: OAuthTokenResponse;
  state?: string;
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
      throw new Error((params.error as string) || 'OAuth failed');
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
 * Validate the state parameter from the callback
 */
export function validateState(receivedState: string): boolean {
  if (!oauthState) {
    return false;
  }

  const isValid = receivedState === oauthState;

  // Clear the state after validation (single use)
  oauthState = null;

  return isValid;
}

/**
 * Redeem the one-time code for the token, presenting the verifier the challenge
 * was made from. Over HTTPS to the proxy, so nothing on the device sees it.
 */
async function redeemCode(code: string, verifier: string): Promise<OAuthTokenResponse> {
  const response = await fetch(`${OAUTH.PROXY_URL}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier }),
  });

  if (!response.ok) {
    throw new Error('OAuth code could not be redeemed');
  }

  const body = (await response.json()) as Partial<OAuthTokenResponse> & { success?: boolean };
  if (!body.access_token || !body.athlete_id) {
    throw new Error('OAuth code exchange returned no token');
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
  const callback = parseCallbackUrl(url);

  if (!callback) {
    throw new Error('Invalid OAuth callback URL - missing token data');
  }

  // Validate state parameter for CSRF protection
  // The state should be present in the callback and match what we generated
  if (!callback.state) {
    throw new Error('OAuth callback missing state parameter - possible CSRF attack');
  }

  if (!validateState(callback.state)) {
    throw new Error('OAuth state validation failed - possible CSRF attack');
  }

  // Spent either way: a failed redemption must not leave it for a second try.
  const verifier = oauthVerifier;
  oauthVerifier = null;

  if (callback.code) {
    if (!verifier) {
      throw new Error('OAuth callback carried a code this app did not start a flow for');
    }
    return redeemCode(callback.code, verifier);
  }

  if (callback.token) {
    return callback.token;
  }

  throw new Error('Invalid OAuth callback URL - missing token data');
}

/**
 * Get the app's OAuth redirect URI (for deep linking setup)
 */
export function getAppRedirectUri(): string {
  return `${OAUTH.APP_SCHEME}://oauth/callback`;
}

// Re-export INTERVALS_URLS from constants for backwards compatibility
export { INTERVALS_URLS } from '@/shared/app/constants';
