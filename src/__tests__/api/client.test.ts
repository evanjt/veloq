/**
 * Tests for the API client (src/api/client.ts).
 *
 * Covers:
 * - Auth header injection (API key basic auth, OAuth bearer token)
 * - 429 retry with exponential backoff
 * - Network error retry
 * - Max retries exhaustion
 * - 401 OAuth session expiry handling
 * - Retry-After header respect
 */

import axios, { AxiosError, AxiosHeaders, InternalAxiosRequestConfig } from 'axios';

// ---- Mocks (must be declared before imports that use them) ----

const mockGetStoredCredentials = jest.fn<
  {
    apiKey: string | null;
    accessToken: string | null;
    athleteId: string | null;
    authMethod: 'oauth' | 'apiKey' | 'demo' | null;
  },
  []
>();

const mockHandleSessionExpired = jest.fn().mockResolvedValue(undefined);

jest.mock('@/providers', () => ({
  getStoredCredentials: (...args: unknown[]) => mockGetStoredCredentials(...(args as [])),
  useAuthStore: {
    getState: () => ({
      handleSessionExpired: mockHandleSessionExpired,
    }),
  },
}));

// ---- Import after mocks ----

import { apiClient, getAthleteId } from '@/api/client';

// ---- Helpers ----

/** Build an AxiosError-like object that the interceptor expects. */
function makeAxiosError(opts: {
  status?: number;
  code?: string;
  headers?: Record<string, string>;
  config?: Partial<InternalAxiosRequestConfig>;
}): AxiosError {
  const config: InternalAxiosRequestConfig = {
    headers: new AxiosHeaders(),
    url: '/test',
    method: 'get',
    ...opts.config,
  };

  const error = new AxiosError(
    opts.status ? `Request failed with status code ${opts.status}` : 'Network Error',
    opts.code ?? (opts.status ? 'ERR_BAD_RESPONSE' : 'ERR_NETWORK'),
    config,
    {},
    opts.status
      ? {
          status: opts.status,
          statusText: opts.status === 429 ? 'Too Many Requests' : 'Error',
          headers: opts.headers ?? {},
          config,
          data: null,
        }
      : undefined
  );
  return error;
}

// ---- Test Suite ----

describe('API Client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: API key auth
    mockGetStoredCredentials.mockReturnValue({
      apiKey: 'test-key-123',
      accessToken: null,
      athleteId: 'i99999',
      authMethod: 'apiKey',
    });
  });

  // ===========================================================================
  // Auth header injection
  // ===========================================================================
  describe('authentication', () => {
    it('includes Basic auth header for API key auth', async () => {
      // The request interceptor runs synchronously on every request.
      // We can trigger it by making a request and inspecting the config.
      const interceptor = (
        apiClient.interceptors.request as unknown as {
          handlers: {
            fulfilled?: (config: InternalAxiosRequestConfig) => InternalAxiosRequestConfig;
          }[];
        }
      ).handlers[0];
      const config: InternalAxiosRequestConfig = {
        headers: new AxiosHeaders(),
        url: '/athlete/i99999',
        method: 'get',
      };

      const result = interceptor.fulfilled!(config);

      const expected = `Basic ${btoa('API_KEY:test-key-123')}`;
      expect((result as InternalAxiosRequestConfig).headers.Authorization).toBe(expected);
    });

    it('includes Bearer token for OAuth auth', async () => {
      mockGetStoredCredentials.mockReturnValue({
        apiKey: null,
        accessToken: 'oauth-token-abc',
        athleteId: 'i99999',
        authMethod: 'oauth',
      });

      const interceptor = (
        apiClient.interceptors.request as unknown as {
          handlers: {
            fulfilled?: (config: InternalAxiosRequestConfig) => InternalAxiosRequestConfig;
          }[];
        }
      ).handlers[0];
      const config: InternalAxiosRequestConfig = {
        headers: new AxiosHeaders(),
        url: '/athlete/i99999',
        method: 'get',
      };

      const result = interceptor.fulfilled!(config);

      expect((result as InternalAxiosRequestConfig).headers.Authorization).toBe(
        'Bearer oauth-token-abc'
      );
    });

    it('does not set Authorization when no credentials', async () => {
      mockGetStoredCredentials.mockReturnValue({
        apiKey: null,
        accessToken: null,
        athleteId: null,
        authMethod: null,
      });

      const interceptor = (
        apiClient.interceptors.request as unknown as {
          handlers: {
            fulfilled?: (config: InternalAxiosRequestConfig) => InternalAxiosRequestConfig;
          }[];
        }
      ).handlers[0];
      const config: InternalAxiosRequestConfig = {
        headers: new AxiosHeaders(),
        url: '/test',
        method: 'get',
      };

      const result = interceptor.fulfilled!(config);

      expect((result as InternalAxiosRequestConfig).headers.Authorization).toBeUndefined();
    });

    it('prefers OAuth over API key when both present', async () => {
      mockGetStoredCredentials.mockReturnValue({
        apiKey: 'test-key-123',
        accessToken: 'oauth-token-abc',
        athleteId: 'i99999',
        authMethod: 'oauth',
      });

      const interceptor = (
        apiClient.interceptors.request as unknown as {
          handlers: {
            fulfilled?: (config: InternalAxiosRequestConfig) => InternalAxiosRequestConfig;
          }[];
        }
      ).handlers[0];
      const config: InternalAxiosRequestConfig = {
        headers: new AxiosHeaders(),
        url: '/test',
        method: 'get',
      };

      const result = interceptor.fulfilled!(config);

      expect((result as InternalAxiosRequestConfig).headers.Authorization).toBe(
        'Bearer oauth-token-abc'
      );
    });
  });

  // ===========================================================================
  // Retry logic
  // ===========================================================================
  describe('retry logic', () => {
    let responseInterceptorRejected: (error: AxiosError) => Promise<unknown>;

    beforeEach(() => {
      // Grab the response error handler (second interceptor arg).
      // The response interceptor is the first handler registered on the response side.
      const handler = (
        apiClient.interceptors.response as unknown as {
          handlers: { rejected?: (error: AxiosError) => Promise<unknown> }[];
        }
      ).handlers[0];
      responseInterceptorRejected = handler.rejected! as (error: AxiosError) => Promise<unknown>;

      // Mock apiClient.request to prevent actual HTTP calls during retries.
      // The interceptor calls `apiClient.request(config)` on retry.
      jest.spyOn(apiClient, 'request').mockResolvedValue({ data: 'ok', status: 200 });
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('retries on 429 with exponential backoff', async () => {
      jest.useFakeTimers();

      const error = makeAxiosError({ status: 429 });

      // First retry attempt (__retryCount starts at 0)
      const promise = responseInterceptorRejected(error);

      // Backoff: max(0, 1000 * 2^0) = 1000ms
      jest.advanceTimersByTime(1000);
      await promise;

      expect(apiClient.request).toHaveBeenCalledTimes(1);
      expect((apiClient.request as jest.Mock).mock.calls[0][0].__retryCount).toBe(1);

      jest.useRealTimers();
    });

    it('retries on network error with longer backoff', async () => {
      jest.useFakeTimers();

      const error = makeAxiosError({ code: 'ERR_NETWORK' });

      const promise = responseInterceptorRejected(error);

      // Network backoff: max(0, 2000 * 2^0) = 2000ms
      jest.advanceTimersByTime(2000);
      await promise;

      expect(apiClient.request).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    it('retries on ECONNABORTED', async () => {
      jest.useFakeTimers();

      const error = makeAxiosError({ code: 'ECONNABORTED' });

      const promise = responseInterceptorRejected(error);
      jest.advanceTimersByTime(2000);
      await promise;

      expect(apiClient.request).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    it('retries on ETIMEDOUT', async () => {
      jest.useFakeTimers();

      const error = makeAxiosError({ code: 'ETIMEDOUT' });

      const promise = responseInterceptorRejected(error);
      jest.advanceTimersByTime(2000);
      await promise;

      expect(apiClient.request).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    it('stops after max retries (3)', async () => {
      jest.useFakeTimers();

      // Simulate a config that has already been retried 3 times
      const error = makeAxiosError({
        status: 429,
        config: { __retryCount: 3 } as unknown as Partial<InternalAxiosRequestConfig>,
      });

      const promise = responseInterceptorRejected(error);

      // Should reject immediately without retrying
      await expect(promise).rejects.toThrow();
      expect(apiClient.request).not.toHaveBeenCalled();

      jest.useRealTimers();
    });

    it('respects Retry-After header', async () => {
      jest.useFakeTimers();

      const error = makeAxiosError({
        status: 429,
        headers: { 'retry-after': '5' }, // 5 seconds
      });

      const promise = responseInterceptorRejected(error);

      // Retry-After = 5s = 5000ms, base backoff = 1000 * 2^0 = 1000ms
      // Should use max(5000, 1000) = 5000ms
      jest.advanceTimersByTime(4999);
      // Still waiting
      expect(apiClient.request).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      await promise;

      expect(apiClient.request).toHaveBeenCalledTimes(1);

      jest.useRealTimers();
    });

    it('uses exponential backoff with increasing delays', async () => {
      jest.useFakeTimers();

      // Simulate second retry (retryCount=1): backoff = 1000 * 2^1 = 2000ms
      const error = makeAxiosError({
        status: 429,
        config: { __retryCount: 1 } as unknown as Partial<InternalAxiosRequestConfig>,
      });

      const promise = responseInterceptorRejected(error);

      jest.advanceTimersByTime(1999);
      expect(apiClient.request).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1);
      await promise;

      expect(apiClient.request).toHaveBeenCalledTimes(1);
      expect((apiClient.request as jest.Mock).mock.calls[0][0].__retryCount).toBe(2);

      jest.useRealTimers();
    });

    it('does not retry on 500 server errors', async () => {
      const error = makeAxiosError({ status: 500 });

      await expect(responseInterceptorRejected(error)).rejects.toThrow();
      expect(apiClient.request).not.toHaveBeenCalled();
    });

    it('does not retry on 404 not found', async () => {
      const error = makeAxiosError({ status: 404 });

      await expect(responseInterceptorRejected(error)).rejects.toThrow();
      expect(apiClient.request).not.toHaveBeenCalled();
    });

    it('rejects when error has no config', async () => {
      const error = new AxiosError('No config');
      // error.config is undefined by default

      await expect(responseInterceptorRejected(error)).rejects.toThrow();
      expect(apiClient.request).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // 401 session expiry
  // ===========================================================================
  describe('session expiry (401)', () => {
    let responseInterceptorRejected: (error: AxiosError) => Promise<unknown>;

    beforeEach(() => {
      const handler = (
        apiClient.interceptors.response as unknown as {
          handlers: { rejected?: (error: AxiosError) => Promise<unknown> }[];
        }
      ).handlers[0];
      responseInterceptorRejected = handler.rejected! as (error: AxiosError) => Promise<unknown>;

      mockGetStoredCredentials.mockReturnValue({
        apiKey: null,
        accessToken: 'expired-token',
        athleteId: 'i99999',
        authMethod: 'oauth',
      });
    });

    it('triggers session expiry on 401 for OAuth', async () => {
      const error = makeAxiosError({ status: 401 });

      await expect(responseInterceptorRejected(error)).rejects.toThrow();

      expect(mockHandleSessionExpired).toHaveBeenCalledWith('token_expired');
    });

    it('does not trigger session expiry on 401 for API key auth', async () => {
      mockGetStoredCredentials.mockReturnValue({
        apiKey: 'test-key',
        accessToken: null,
        athleteId: 'i99999',
        authMethod: 'apiKey',
      });

      const error = makeAxiosError({ status: 401 });

      await expect(responseInterceptorRejected(error)).rejects.toThrow();

      expect(mockHandleSessionExpired).not.toHaveBeenCalled();
    });

    it('does not trigger session expiry when __skipSessionExpiry is set', async () => {
      const error = makeAxiosError({
        status: 401,
        config: { __skipSessionExpiry: true } as unknown as Partial<InternalAxiosRequestConfig>,
      });

      await expect(responseInterceptorRejected(error)).rejects.toThrow();

      expect(mockHandleSessionExpired).not.toHaveBeenCalled();
    });

    it('does not retry 401 errors', async () => {
      jest.spyOn(apiClient, 'request').mockResolvedValue({ data: 'ok' });

      const error = makeAxiosError({ status: 401 });

      await expect(responseInterceptorRejected(error)).rejects.toThrow();

      expect(apiClient.request).not.toHaveBeenCalled();

      jest.restoreAllMocks();
    });
  });

  // ===========================================================================
  // getAthleteId
  // ===========================================================================
  describe('getAthleteId', () => {
    it('returns athlete ID from credentials', () => {
      expect(getAthleteId()).toBe('i99999');
    });

    it('returns empty string when no athlete ID', () => {
      mockGetStoredCredentials.mockReturnValue({
        apiKey: null,
        accessToken: null,
        athleteId: null,
        authMethod: null,
      });

      expect(getAthleteId()).toBe('');
    });
  });

  // ===========================================================================
  // Client configuration
  // ===========================================================================
  describe('client configuration', () => {
    it('has correct base URL', () => {
      expect(apiClient.defaults.baseURL).toBe('https://intervals.icu/api/v1');
    });

    it('has 30 second timeout', () => {
      expect(apiClient.defaults.timeout).toBe(30000);
    });

    it('sets Content-Type to application/json', () => {
      expect(apiClient.defaults.headers['Content-Type']).toBe('application/json');
    });
  });
});
