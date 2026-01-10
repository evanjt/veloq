/**
 * Veloq OAuth Proxy - Cloudflare Worker
 *
 * Handles OAuth token exchange and webhooks for intervals.icu
 * Deploy via Cloudflare Dashboard: Workers & Pages > Create > Create Worker
 *
 * Required secrets (set in Dashboard > Settings > Variables):
 * - INTERVALS_CLIENT_ID
 * - INTERVALS_CLIENT_SECRET
 * - WEBHOOK_SECRET
 *
 * Required KV namespace (create in Dashboard > KV > Create):
 * - Bind as "WEBHOOK_EVENTS"
 */

interface Env {
  INTERVALS_CLIENT_ID: string;
  INTERVALS_CLIENT_SECRET: string;
  WEBHOOK_SECRET: string;
  WEBHOOK_EVENTS: KVNamespace;
}

interface IntervalsTokenResponse {
  token_type: string;
  access_token: string;
  scope: string;
  athlete: {
    id: string;
    name: string;
  };
}

interface WebhookPayload {
  type: string;
  athlete_id?: string;
  activity_id?: number;
}

interface StoredWebhookEvent {
  event_type: string;
  athlete_id?: string;
  activity_id?: number;
  timestamp: number;
}

const INTERVALS_TOKEN_URL = 'https://intervals.icu/api/oauth/token';
const APP_SCHEME = 'veloq';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      // Health check
      if (path === '/health') {
        return new Response('OK', { status: 200 });
      }

      // OAuth callback
      if (path === '/oauth/callback' && request.method === 'GET') {
        return handleOAuthCallback(url, env);
      }

      // Webhook receiver
      if (path === '/webhooks/intervals' && request.method === 'POST') {
        return handleWebhook(request, env);
      }

      // Get webhooks for athlete
      if (path.startsWith('/webhooks/') && request.method === 'GET') {
        const athleteId = path.replace('/webhooks/', '');
        if (athleteId && athleteId !== 'intervals') {
          return handleGetWebhooks(athleteId, env);
        }
      }

      return new Response('Not Found', { status: 404 });
    } catch (error) {
      console.error('Worker error:', error);
      return new Response('Internal Server Error', { status: 500 });
    }
  },
};

/**
 * Handle OAuth callback from intervals.icu
 * Exchanges authorization code for access token, then redirects to app
 */
async function handleOAuthCallback(url: URL, env: Env): Promise<Response> {
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  // Handle error from intervals.icu
  if (error) {
    return redirectToAppWithError(error);
  }

  // Validate code exists
  if (!code) {
    return redirectToAppWithError('missing_code');
  }

  // Exchange code for token
  const formData = new URLSearchParams({
    client_id: env.INTERVALS_CLIENT_ID,
    client_secret: env.INTERVALS_CLIENT_SECRET,
    code: code,
  });

  const tokenResponse = await fetch(INTERVALS_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: formData.toString(),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error('Token exchange failed:', tokenResponse.status, errorText);
    return redirectToAppWithError('token_exchange_failed');
  }

  const tokenData: IntervalsTokenResponse = await tokenResponse.json();

  // Validate response
  if (!tokenData.access_token || !tokenData.athlete?.id) {
    console.error('Invalid token response:', tokenData);
    return redirectToAppWithError('invalid_response');
  }

  // Redirect to app with token
  return redirectToAppWithToken(tokenData);
}

/**
 * Redirect to app with successful token
 */
function redirectToAppWithToken(token: IntervalsTokenResponse): Response {
  const params = new URLSearchParams({
    success: 'true',
    access_token: token.access_token,
    token_type: token.token_type,
    scope: token.scope,
    athlete_id: token.athlete.id,
    athlete_name: token.athlete.name,
  });

  const redirectUrl = `${APP_SCHEME}://oauth/callback?${params.toString()}`;

  return Response.redirect(redirectUrl, 302);
}

/**
 * Redirect to app with error
 */
function redirectToAppWithError(error: string): Response {
  const params = new URLSearchParams({
    success: 'false',
    error: error,
  });

  const redirectUrl = `${APP_SCHEME}://oauth/callback?${params.toString()}`;

  return Response.redirect(redirectUrl, 302);
}

/**
 * Handle incoming webhook from intervals.icu
 */
async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const bodyText = await request.text();

  // Parse webhook payload
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    console.error('Failed to parse webhook payload');
    return new Response('Invalid JSON', { status: 400 });
  }

  // Validate athlete_id
  const athleteId = payload.athlete_id;
  if (!athleteId) {
    console.error('Webhook missing athlete_id');
    return new Response('Missing athlete_id', { status: 400 });
  }

  // Create stored event
  const event: StoredWebhookEvent = {
    event_type: payload.type,
    athlete_id: payload.athlete_id,
    activity_id: payload.activity_id,
    timestamp: Date.now(),
  };

  // Store in KV with 24-hour TTL
  const key = `${athleteId}:${event.timestamp}`;
  await env.WEBHOOK_EVENTS.put(key, JSON.stringify(event), {
    expirationTtl: 86400, // 24 hours
  });

  console.log(`Stored webhook: ${payload.type} for athlete ${athleteId}`);

  return new Response('OK', { status: 200 });
}

/**
 * Get pending webhooks for an athlete (app polls this)
 */
async function handleGetWebhooks(athleteId: string, env: Env): Promise<Response> {
  // List all keys for this athlete
  const prefix = `${athleteId}:`;
  const list = await env.WEBHOOK_EVENTS.list({ prefix });

  const events: StoredWebhookEvent[] = [];

  // Fetch and delete each event (one-time delivery)
  for (const key of list.keys) {
    const value = await env.WEBHOOK_EVENTS.get(key.name);
    if (value) {
      try {
        const event: StoredWebhookEvent = JSON.parse(value);
        events.push(event);
      } catch {
        // Skip invalid entries
      }
      // Delete after reading
      await env.WEBHOOK_EVENTS.delete(key.name);
    }
  }

  // Sort by timestamp (newest first)
  events.sort((a, b) => b.timestamp - a.timestamp);

  return new Response(JSON.stringify(events), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
    },
  });
}
