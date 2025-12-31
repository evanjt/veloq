import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import axios from 'axios';

// OAuth configuration for intervals.icu
// Client ID must be obtained by registering with david@intervals.icu
const OAUTH_CONFIG = {
  clientId: process.env.EXPO_PUBLIC_INTERVALS_CLIENT_ID || '',
  clientSecret: process.env.EXPO_PUBLIC_INTERVALS_CLIENT_SECRET || '',
  authorizationEndpoint: 'https://intervals.icu/oauth/authorize',
  tokenEndpoint: 'https://intervals.icu/api/oauth/token',
  redirectUri: 'veloq://oauth/callback',
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
 * Check if OAuth is configured (client ID is set)
 */
export function isOAuthConfigured(): boolean {
  return !!OAUTH_CONFIG.clientId;
}

/**
 * Get the OAuth client ID (for display/debugging)
 */
export function getOAuthClientId(): string {
  return OAUTH_CONFIG.clientId;
}

/**
 * Build the OAuth authorization URL
 */
export function buildAuthorizationUrl(): string {
  oauthState = generateState();

  const params = new URLSearchParams({
    client_id: OAUTH_CONFIG.clientId,
    redirect_uri: OAUTH_CONFIG.redirectUri,
    scope: OAUTH_CONFIG.scopes.join(','),
    response_type: 'code',
    state: oauthState,
  });

  return `${OAUTH_CONFIG.authorizationEndpoint}?${params.toString()}`;
}

/**
 * Start the OAuth flow by opening the authorization URL in the browser
 */
export async function startOAuthFlow(): Promise<WebBrowser.WebBrowserResult> {
  if (!isOAuthConfigured()) {
    throw new Error('OAuth is not configured. Please set EXPO_PUBLIC_INTERVALS_CLIENT_ID.');
  }

  const authUrl = buildAuthorizationUrl();

  // Open browser for authorization
  // Using openAuthSessionAsync for better redirect handling
  const result = await WebBrowser.openAuthSessionAsync(authUrl, OAUTH_CONFIG.redirectUri);

  return result;
}

/**
 * Parse the OAuth callback URL and extract the authorization code
 */
export function parseCallbackUrl(url: string): { code: string; state: string } | null {
  try {
    const parsed = Linking.parse(url);

    if (parsed.queryParams?.code && parsed.queryParams?.state) {
      return {
        code: parsed.queryParams.code as string,
        state: parsed.queryParams.state as string,
      };
    }

    return null;
  } catch {
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
 * Exchange the authorization code for an access token
 */
export async function exchangeCodeForToken(code: string): Promise<OAuthTokenResponse> {
  if (!OAUTH_CONFIG.clientId || !OAUTH_CONFIG.clientSecret) {
    throw new Error('OAuth client credentials not configured');
  }

  const response = await axios.post<OAuthTokenResponse>(
    OAUTH_CONFIG.tokenEndpoint,
    new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: OAUTH_CONFIG.redirectUri,
      client_id: OAUTH_CONFIG.clientId,
      client_secret: OAUTH_CONFIG.clientSecret,
    }).toString(),
    {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 30000,
    }
  );

  return response.data;
}

/**
 * Handle the complete OAuth callback flow
 * Returns the token response or throws an error
 */
export async function handleOAuthCallback(url: string): Promise<OAuthTokenResponse> {
  const params = parseCallbackUrl(url);

  if (!params) {
    throw new Error('Invalid OAuth callback URL');
  }

  if (!validateState(params.state)) {
    throw new Error('Invalid OAuth state parameter - possible CSRF attack');
  }

  const tokenResponse = await exchangeCodeForToken(params.code);

  return tokenResponse;
}

/**
 * Get the OAuth redirect URI for registration
 */
export function getRedirectUri(): string {
  return OAUTH_CONFIG.redirectUri;
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
};
