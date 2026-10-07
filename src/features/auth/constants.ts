// OAuth configuration for intervals.icu.
// See oauth-proxy/README.md for registration details.
// WRITE implies READ - don't request both for the same category.
// Sign-in asks for read scopes only. ACTIVITY:WRITE is requested by the upgrade on first record.
export const OAUTH = {
  CLIENT_ID: '182',
  PROXY_URL: 'https://auth.veloq.fit',
  AUTH_ENDPOINT: 'https://intervals.icu/oauth/authorize',
  APP_SCHEME: 'veloq',
  SCOPES: ['ACTIVITY:READ', 'WELLNESS:READ', 'CALENDAR:READ', 'SETTINGS:READ'],
  // In-app upgrade on first record. ACTIVITY:WRITE implies ACTIVITY:READ.
  UPGRADE_SCOPES: ['ACTIVITY:WRITE', 'WELLNESS:READ', 'CALENDAR:READ', 'SETTINGS:READ'],
} as const;
