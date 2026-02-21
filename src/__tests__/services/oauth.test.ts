/**
 * Tests for OAuth service.
 * Tests pure functions only (parseCallbackUrl, validateState, isOAuthConfigured).
 * The flow functions (startOAuthFlow, handleOAuthCallback) require browser + network.
 */

// Mock expo modules before imports
jest.mock('expo-web-browser', () => ({
  openAuthSessionAsync: jest.fn(),
}));

jest.mock('expo-linking', () => ({
  parse: jest.fn((url: string) => {
    try {
      const urlObj = new URL(url);
      const queryParams: Record<string, string> = {};
      urlObj.searchParams.forEach((value, key) => {
        queryParams[key] = value;
      });
      return { queryParams };
    } catch {
      return { queryParams: null };
    }
  }),
}));

import {
  isOAuthConfigured,
  getOAuthClientId,
  getProxyRedirectUri,
  getAppRedirectUri,
  parseCallbackUrl,
  validateState,
  buildAuthorizationUrl,
} from '@/services/oauth';
import { OAUTH } from '@/lib/utils/constants';

describe('isOAuthConfigured', () => {
  it('returns true when CLIENT_ID and PROXY_URL are set', () => {
    // OAUTH constants are non-empty in the actual codebase
    expect(isOAuthConfigured()).toBe(true);
  });
});

describe('getOAuthClientId', () => {
  it('returns the configured client ID', () => {
    expect(getOAuthClientId()).toBe(OAUTH.CLIENT_ID);
  });
});

describe('getProxyRedirectUri', () => {
  it('returns proxy callback URL', () => {
    expect(getProxyRedirectUri()).toBe(`${OAUTH.PROXY_URL}/oauth/callback`);
  });
});

describe('getAppRedirectUri', () => {
  it('returns app deep link callback URL', () => {
    expect(getAppRedirectUri()).toBe('veloq://oauth/callback');
  });
});

describe('parseCallbackUrl', () => {
  it('parses successful OAuth callback', () => {
    const url =
      'veloq://oauth/callback?success=true&access_token=tok123&athlete_id=i42&athlete_name=Alice&state=abc&token_type=Bearer&scope=read';
    const result = parseCallbackUrl(url);
    expect(result).not.toBeNull();
    expect(result!.access_token).toBe('tok123');
    expect(result!.athlete_id).toBe('i42');
    expect(result!.athlete_name).toBe('Alice');
    expect(result!.state).toBe('abc');
    expect(result!.token_type).toBe('Bearer');
  });

  it('returns null for missing required fields', () => {
    const url = 'veloq://oauth/callback?success=true&access_token=tok123';
    const result = parseCallbackUrl(url);
    expect(result).toBeNull();
  });

  it('throws on error response', () => {
    const url = 'veloq://oauth/callback?success=false&error=access_denied';
    expect(() => parseCallbackUrl(url)).toThrow('access_denied');
  });

  it('returns null for empty query params', () => {
    const url = 'veloq://oauth/callback';
    const result = parseCallbackUrl(url);
    expect(result).toBeNull();
  });

  it('defaults token_type to Bearer when missing', () => {
    const url = 'veloq://oauth/callback?success=true&access_token=tok&athlete_id=i1&state=s';
    const result = parseCallbackUrl(url);
    expect(result!.token_type).toBe('Bearer');
  });
});

describe('validateState', () => {
  it('returns false when no state was generated', () => {
    // No state has been set in this test module
    expect(validateState('anything')).toBe(false);
  });
});

describe('buildAuthorizationUrl', () => {
  it('throws when state is not initialized', () => {
    // State is null since startOAuthFlow hasn't been called
    expect(() => buildAuthorizationUrl()).toThrow('OAuth state not initialized');
  });
});
