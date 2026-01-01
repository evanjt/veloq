import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { getStoredCredentials } from '@/providers';

// Extended config type to track retry count
interface RetryableAxiosRequestConfig extends InternalAxiosRequestConfig {
  __retryCount?: number;
}

export const apiClient = axios.create({
  baseURL: 'https://intervals.icu/api/v1',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add auth header dynamically from secure store
apiClient.interceptors.request.use((config) => {
  const { apiKey } = getStoredCredentials();
  if (apiKey) {
    // Basic auth with "API_KEY" as username and actual key as password
    const encoded = btoa(`API_KEY:${apiKey}`);
    config.headers.Authorization = `Basic ${encoded}`;
  }
  return config;
});

// Rate limiting is handled by adaptiveRateLimiter.ts for bulk operations
// See: https://forum.intervals.icu/t/solved-guidance-on-api-rate-limits-for-bulk-activity-reloading/110818
// Limits: 30 req/s burst, 132 req/10s sustained

// Retry configuration for 429 and network errors
const MAX_RETRIES = 3;
const INITIAL_BACKOFF = 1000; // 1 second
const NETWORK_BACKOFF = 2000; // 2 seconds for network errors

// Network error codes that should trigger retry
const NETWORK_ERROR_CODES = ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'];

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetryableAxiosRequestConfig | undefined;
    if (!config) return Promise.reject(error);

    // Initialize retry count
    const retryCount = config.__retryCount ?? 0;

    // Check if this is a retryable error
    const isRateLimitError = error.response?.status === 429;
    const isNetworkError = NETWORK_ERROR_CODES.includes(error.code ?? '');
    const shouldRetry = (isRateLimitError || isNetworkError) && retryCount < MAX_RETRIES;

    if (shouldRetry) {
      config.__retryCount = retryCount + 1;

      // Use longer backoff for network errors since they may need more time to recover
      const baseBackoff = isNetworkError ? NETWORK_BACKOFF : INITIAL_BACKOFF;
      const backoffTime = baseBackoff * Math.pow(2, retryCount);

      await new Promise((resolve) => setTimeout(resolve, backoffTime));
      return apiClient.request(config);
    }

    return Promise.reject(error);
  }
);

export const getAthleteId = () => {
  const { athleteId } = getStoredCredentials();
  return athleteId || '';
};
