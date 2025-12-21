import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';

// Extended config type to track retry count
interface RetryableAxiosRequestConfig extends InternalAxiosRequestConfig {
  __retryCount?: number;
}

const API_KEY = process.env.EXPO_PUBLIC_API_KEY || '';
const ATHLETE_ID = process.env.EXPO_PUBLIC_ATHLETE_ID || '';

export const apiClient = axios.create({
  baseURL: 'https://intervals.icu/api/v1',
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
  auth: {
    username: 'API_KEY',
    password: API_KEY,
  },
});

// Rate limiting configuration
// intervals.icu limits: 30 req/s (1s window), 132 req/10s
// We use 10 req/s sustained rate as recommended
// See: https://forum.intervals.icu/t/solved-guidance-on-api-rate-limits-for-bulk-activity-reloading/110818
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 100; // 10 req/s (recommended rate)

// Track requests in sliding window for burst protection
const requestTimestamps: number[] = [];
const WINDOW_SIZE = 10000; // 10 second window
const MAX_REQUESTS_PER_WINDOW = 80; // Under 132/10s limit per API docs

apiClient.interceptors.request.use(async (config) => {
  const now = Date.now();

  // Clean old timestamps outside window
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - WINDOW_SIZE) {
    requestTimestamps.shift();
  }

  // If we're at the limit, wait until oldest request falls out of window
  if (requestTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    const waitTime = requestTimestamps[0] + WINDOW_SIZE - now + 100;
    console.log(`Rate limit protection: waiting ${waitTime}ms`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }

  // Ensure minimum interval between requests
  const timeSinceLastRequest = now - lastRequestTime;
  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest)
    );
  }

  lastRequestTime = Date.now();
  requestTimestamps.push(Date.now());
  return config;
});

// Retry configuration for 429 errors
const MAX_RETRIES = 3;
const INITIAL_BACKOFF = 1000; // 1 second

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const config = error.config as RetryableAxiosRequestConfig | undefined;
    if (!config) return Promise.reject(error);

    // Initialize retry count
    const retryCount = config.__retryCount ?? 0;

    if (error.response?.status === 429 && retryCount < MAX_RETRIES) {
      config.__retryCount = retryCount + 1;

      // Exponential backoff: 1s, 2s, 4s
      const backoffTime = INITIAL_BACKOFF * Math.pow(2, retryCount);
      console.warn(`Rate limited (429). Retry ${retryCount + 1}/${MAX_RETRIES} after ${backoffTime}ms`);

      await new Promise((resolve) => setTimeout(resolve, backoffTime));
      return apiClient.request(config);
    }

    if (error.response?.status === 429) {
      console.error('Rate limited by intervals.icu API after max retries');
    }

    return Promise.reject(error);
  }
);

export const getAthleteId = () => ATHLETE_ID;
