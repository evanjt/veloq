// OAuth configuration for intervals.icu.
// See oauth-proxy/README.md for registration details.
// WRITE implies READ — don't request both for the same category.
// ACTIVITY:WRITE removed for 0.3.0 — recording not shipping yet, no write access needed.
export const OAUTH = {
  CLIENT_ID: '182',
  PROXY_URL: 'https://auth.veloq.fit',
  AUTH_ENDPOINT: 'https://intervals.icu/oauth/authorize',
  APP_SCHEME: 'veloq',
  SCOPES: ['ACTIVITY:READ', 'WELLNESS:READ', 'CALENDAR:READ', 'SETTINGS:READ'],
} as const;
