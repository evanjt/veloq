import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { OAUTH } from '@/lib/utils/constants';

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

function generateState(): string {
  const array = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(array);
  } else {
    // Fallback for React Native
    for (let i = 0; i < array.length; i++) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  return Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface OAuthTokenResponse {
  access_token: string;
  token_type: string;
  scope: string;
  athlete_id: string;
  athlete_name: string;
  state?: string;
}

export interface OAuthError {
  error: string;
  error_description?: string;
}

/**
 * Check if OAuth is configured (client ID and proxy URL are set)
 */
export function isOAuthConfigured(): boolean {
  return !!OAUTH.CLIENT_ID && !!OAUTH.PROXY_URL;
}

/**
 * Get the OAuth client ID (for display/debugging)
 */
export function getOAuthClientId(): string {
  return OAUTH.CLIENT_ID;
}

/**
 * Get the proxy redirect URI (for registration with intervals.icu)
 */
export function getProxyRedirectUri(): string {
  return `${OAUTH.PROXY_URL}/oauth/callback`;
}

/**
 * Build the OAuth authorization URL
 * Redirects to the proxy, which then redirects to the app with the token
 * Note: oauthState must be set before calling this function
 */
export function buildAuthorizationUrl(): string {
  if (!oauthState) {
    throw new Error('OAuth state not initialized. Call startOAuthFlow() instead.');
  }

  // The redirect_uri points to our proxy, not the app directly
  const proxyRedirectUri = getProxyRedirectUri();

  const params = new URLSearchParams({
    client_id: OAUTH.CLIENT_ID,
    redirect_uri: proxyRedirectUri,
    scope: OAUTH.SCOPES.join(','),
    response_type: 'code',
    state: oauthState,
  });

  return `${OAUTH.AUTH_ENDPOINT}?${params.toString()}`;
}

/**
 * Register the OAuth state with the proxy for CSRF protection
 * This must be called before the OAuth flow starts
 */
async function registerStateWithProxy(state: string): Promise<void> {
  const response = await fetch(`${OAUTH.PROXY_URL}/oauth/state`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ state }),
  });

  if (!response.ok) {
    throw new Error('Failed to register OAuth state with proxy');
  }
}

/**
 * Start the OAuth flow by opening the authorization URL in the browser
 *
 * Flow:
 * 1. App generates state and registers it with proxy (CSRF protection)
 * 2. App opens browser to intervals.icu/oauth/authorize
 * 3. User logs in and approves
 * 4. intervals.icu redirects to proxy with auth code and state
 * 5. Proxy validates state, exchanges code for token (with client_secret)
 * 6. Proxy redirects to app with token via deep link
 */
export async function startOAuthFlow(): Promise<WebBrowser.WebBrowserAuthSessionResult> {
  if (!isOAuthConfigured()) {
    throw new Error(
      'OAuth is not configured. Set CLIENT_ID and PROXY_URL in src/lib/utils/constants.ts'
    );
  }

  // Generate state and register with proxy before building URL
  const state = generateState();
  oauthState = state;

  // Register state with proxy for server-side validation
  await registerStateWithProxy(state);

  const authUrl = buildAuthorizationUrl();
  const appCallbackUrl = `${OAUTH.APP_SCHEME}://oauth/callback`;

  // Open browser for authorization
  // The proxy will redirect back to our app scheme
  const result = await WebBrowser.openAuthSessionAsync(authUrl, appCallbackUrl);

  return result;
}

/**
 * Parse the OAuth callback URL from the proxy
 * The proxy redirects with token params directly in the URL
 */
export function parseCallbackUrl(url: string): OAuthTokenResponse | null {
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

    // Check for success response with all required fields
    if (params.success === 'true' && params.access_token && params.athlete_id) {
      return {
        access_token: params.access_token as string,
        token_type: (params.token_type as string) || 'Bearer',
        scope: (params.scope as string) || '',
        athlete_id: params.athlete_id as string,
        athlete_name: (params.athlete_name as string) || '',
        state: (params.state as string) || undefined,
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
 * Handle the complete OAuth callback flow
 * With the proxy, the token is already in the redirect URL
 *
 * This function validates the CSRF state parameter to prevent attacks.
 * The proxy also validates state server-side, but client-side validation
 * provides defense in depth.
 */
export function handleOAuthCallback(url: string): OAuthTokenResponse {
  const tokenResponse = parseCallbackUrl(url);

  if (!tokenResponse) {
    throw new Error('Invalid OAuth callback URL - missing token data');
  }

  // Validate state parameter for CSRF protection
  // The state should be present in the callback and match what we generated
  if (!tokenResponse.state) {
    throw new Error('OAuth callback missing state parameter - possible CSRF attack');
  }

  if (!validateState(tokenResponse.state)) {
    throw new Error('OAuth state validation failed - possible CSRF attack');
  }

  return tokenResponse;
}

/**
 * Get the app's OAuth redirect URI (for deep linking setup)
 */
export function getAppRedirectUri(): string {
  return `${OAUTH.APP_SCHEME}://oauth/callback`;
}

// Re-export INTERVALS_URLS from constants for backwards compatibility
export { INTERVALS_URLS } from '@/lib/utils/constants';
