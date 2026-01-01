import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';

// OAuth configuration for intervals.icu
// The proxy handles token exchange, keeping client_secret secure
const OAUTH_CONFIG = {
  clientId: process.env.EXPO_PUBLIC_INTERVALS_CLIENT_ID || '',
  // Backend proxy URL - handles token exchange securely
  proxyBaseUrl: process.env.EXPO_PUBLIC_OAUTH_PROXY_URL || '',
  authorizationEndpoint: 'https://intervals.icu/oauth/authorize',
  // App's deep link scheme for receiving the final redirect
  appScheme: 'veloq',
  scopes: ['ACTIVITY:READ', 'WELLNESS:READ', 'CALENDAR:READ', 'SETTINGS:READ'],
};

// State parameter for CSRF protection
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
}

export interface OAuthError {
  error: string;
  error_description?: string;
}

/**
 * Check if OAuth is configured (client ID and proxy URL are set)
 */
export function isOAuthConfigured(): boolean {
  return !!OAUTH_CONFIG.clientId && !!OAUTH_CONFIG.proxyBaseUrl;
}

/**
 * Get the OAuth client ID (for display/debugging)
 */
export function getOAuthClientId(): string {
  return OAUTH_CONFIG.clientId;
}

/**
 * Get the proxy redirect URI (for registration with intervals.icu)
 */
export function getProxyRedirectUri(): string {
  return `${OAUTH_CONFIG.proxyBaseUrl}/oauth/callback`;
}

/**
 * Build the OAuth authorization URL
 * Redirects to the proxy, which then redirects to the app with the token
 */
export function buildAuthorizationUrl(): string {
  oauthState = generateState();

  // The redirect_uri points to our proxy, not the app directly
  const proxyRedirectUri = getProxyRedirectUri();

  const params = new URLSearchParams({
    client_id: OAUTH_CONFIG.clientId,
    redirect_uri: proxyRedirectUri,
    scope: OAUTH_CONFIG.scopes.join(','),
    response_type: 'code',
    state: oauthState,
  });

  return `${OAUTH_CONFIG.authorizationEndpoint}?${params.toString()}`;
}

/**
 * Start the OAuth flow by opening the authorization URL in the browser
 *
 * Flow:
 * 1. App opens browser to intervals.icu/oauth/authorize
 * 2. User logs in and approves
 * 3. intervals.icu redirects to proxy with auth code
 * 4. Proxy exchanges code for token (with client_secret)
 * 5. Proxy redirects to app with token via deep link
 */
export async function startOAuthFlow(): Promise<WebBrowser.WebBrowserResult> {
  if (!isOAuthConfigured()) {
    throw new Error(
      'OAuth is not configured. Please set EXPO_PUBLIC_INTERVALS_CLIENT_ID and EXPO_PUBLIC_OAUTH_PROXY_URL.'
    );
  }

  const authUrl = buildAuthorizationUrl();
  const appCallbackUrl = `${OAUTH_CONFIG.appScheme}://oauth/callback`;

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
    if (
      params.success === 'true' &&
      params.access_token &&
      params.athlete_id
    ) {
      return {
        access_token: params.access_token as string,
        token_type: (params.token_type as string) || 'Bearer',
        scope: (params.scope as string) || '',
        athlete_id: params.athlete_id as string,
        athlete_name: (params.athlete_name as string) || '',
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
 */
export function handleOAuthCallback(url: string): OAuthTokenResponse {
  const tokenResponse = parseCallbackUrl(url);

  if (!tokenResponse) {
    throw new Error('Invalid OAuth callback URL - missing token data');
  }

  // Note: State validation happens at the proxy level now
  // The proxy validates state before exchanging the code

  return tokenResponse;
}

/**
 * Get the app's OAuth redirect URI (for deep linking setup)
 */
export function getAppRedirectUri(): string {
  return `${OAUTH_CONFIG.appScheme}://oauth/callback`;
}

/**
 * External URLs for intervals.icu
 */
export const INTERVALS_URLS = {
  signup: 'https://intervals.icu',
  privacyPolicy: 'https://intervals.icu/privacy-policy.html',
  termsOfService: 'https://forum.intervals.icu/tos',
  apiTerms: 'https://forum.intervals.icu/t/intervals-icu-api-terms-and-conditions/114087',
  settings: 'https://intervals.icu/settings',
  // Direct link to Developer Settings section for API key
  developerSettings: 'https://intervals.icu/settings#developer',
};
