import axios from 'axios';

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

// Rate limiting: simple delay between requests
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 100; // 10 req/s max

apiClient.interceptors.request.use(async (config) => {
  const now = Date.now();
  const timeSinceLastRequest = now - lastRequestTime;

  if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
    await new Promise((resolve) =>
      setTimeout(resolve, MIN_REQUEST_INTERVAL - timeSinceLastRequest)
    );
  }

  lastRequestTime = Date.now();
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 429) {
      console.warn('Rate limited by intervals.icu API');
    }
    return Promise.reject(error);
  }
);

export const getAthleteId = () => ATHLETE_ID;
