/**
 * Veloq API Worker - Cloudflare Worker
 *
 * Handles:
 *   1. OAuth token exchange for intervals.icu (existing)
 *   2. Webhook relay: receives intervals.icu webhooks, sends silent push notifications
 *   3. Device token management: register/unregister push tokens
 *
 * See README.md for deployment instructions.
 *
 * Environment:
 * - INTERVALS_CLIENT_ID: OAuth client ID
 * - INTERVALS_CLIENT_SECRET: OAuth client secret
 * - OAUTH_STATES: KV namespace for CSRF state validation and rate limiting
 * - DEVICE_TOKENS: KV namespace for push token storage
 * - WEBHOOK_SECRET: Shared secret from intervals.icu webhook config
 * - FCM_SERVICE_ACCOUNT_KEY: JSON key for FCM HTTP v1 API (Android push)
 * - APNS_KEY_P8: APNs auth key in PEM format (iOS push)
 * - APNS_KEY_ID: APNs key ID
 * - APNS_TEAM_ID: Apple Developer Team ID
 */

interface Env {
  INTERVALS_CLIENT_ID: string;
  INTERVALS_CLIENT_SECRET: string;
  OAUTH_STATES: KVNamespace;
  DEVICE_TOKENS: KVNamespace;
  WEBHOOK_SECRET?: string;
  FCM_SERVICE_ACCOUNT_KEY?: string;
  APNS_KEY_P8?: string;
  APNS_KEY_ID?: string;
  APNS_TEAM_ID?: string;
}

interface DeviceToken {
  token: string;
  platform: "ios" | "android";
  registeredAt: string;
}

/** Rate limiting configuration */
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_WINDOW_SECONDS = 60;

interface IntervalsTokenResponse {
  token_type: string;
  access_token: string;
  scope: string;
  athlete: {
    id: string;
    name: string;
  };
}

const INTERVALS_TOKEN_URL = "https://intervals.icu/api/oauth/token";
const APP_SCHEME = "veloq";
/** State parameter TTL in seconds (5 minutes - OAuth code expires in 2 min) */
const STATE_TTL_SECONDS = 300;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS is not needed - mobile app uses deep links, not browser requests
    // Return 405 for OPTIONS requests since we don't support CORS
    if (request.method === "OPTIONS") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    try {
      // Health check
      if (path === "/health") {
        return new Response("OK", { status: 200 });
      }

      // Register OAuth state (app calls this before starting OAuth flow)
      if (path === "/oauth/state" && request.method === "POST") {
        return handleRegisterState(request, env);
      }

      // OAuth callback
      if (path === "/oauth/callback" && request.method === "GET") {
        return handleOAuthCallback(url, env);
      }

      // --- Push notification endpoints (additive, backwards-compatible) ---

      // Register device push token
      if (path === "/devices/register" && request.method === "POST") {
        return handleDeviceRegister(request, env);
      }

      // Unregister device push token
      if (path === "/devices/unregister" && request.method === "DELETE") {
        return handleDeviceUnregister(request, env);
      }

      // Webhook receiver for intervals.icu events
      if (path === "/webhook/intervals" && request.method === "POST") {
        return handleIntervalsWebhook(request, env);
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error("Worker error:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
};

/**
 * Check rate limit for an IP address
 * Returns true if request should be allowed, false if rate limited
 */
async function checkRateLimit(ip: string, env: Env): Promise<boolean> {
  const key = `rate:${ip}`;
  const current = await env.OAUTH_STATES.get(key);

  if (!current) {
    // First request in window
    await env.OAUTH_STATES.put(key, "1", {
      expirationTtl: RATE_LIMIT_WINDOW_SECONDS,
    });
    return true;
  }

  const count = parseInt(current, 10);
  if (count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  // Increment counter (preserve existing TTL by using same window)
  await env.OAUTH_STATES.put(key, String(count + 1), {
    expirationTtl: RATE_LIMIT_WINDOW_SECONDS,
  });
  return true;
}

/**
 * Register a state parameter for CSRF protection
 * App calls this before starting OAuth flow
 */
async function handleRegisterState(
  request: Request,
  env: Env
): Promise<Response> {
  // Get client IP for rate limiting
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown";

  // Check rate limit
  const allowed = await checkRateLimit(ip, env);
  if (!allowed) {
    return new Response(
      JSON.stringify({ error: "Too many requests. Please try again later." }),
      {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(RATE_LIMIT_WINDOW_SECONDS),
        },
      }
    );
  }

  try {
    const body = (await request.json()) as { state?: string };
    const state = body.state;

    if (!state || typeof state !== "string" || state.length < 32) {
      return new Response(
        JSON.stringify({ error: "Invalid state parameter" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    // Store state in KV with TTL
    await env.OAUTH_STATES.put(state, "valid", {
      expirationTtl: STATE_TTL_SECONDS,
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
}

/**
 * Handle OAuth callback from intervals.icu
 * Exchanges authorization code for access token, then redirects to app
 */
async function handleOAuthCallback(url: URL, env: Env): Promise<Response> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  // Handle error from intervals.icu
  if (error) {
    return redirectToAppWithError(error);
  }

  // Validate code exists
  if (!code) {
    return redirectToAppWithError("missing_code");
  }

  // Validate state parameter (CSRF protection)
  if (!state) {
    console.error("OAuth callback missing state parameter");
    return redirectToAppWithError("missing_state");
  }

  const storedState = await env.OAUTH_STATES.get(state);
  if (!storedState) {
    console.error(
      "OAuth state not found or expired:",
      state.substring(0, 8) + "..."
    );
    return redirectToAppWithError("invalid_state");
  }

  // Delete state after validation (single use)
  await env.OAUTH_STATES.delete(state);

  // Exchange code for token
  const formData = new URLSearchParams({
    client_id: env.INTERVALS_CLIENT_ID,
    client_secret: env.INTERVALS_CLIENT_SECRET,
    code: code,
  });

  const tokenResponse = await fetch(INTERVALS_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData.toString(),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error("Token exchange failed:", tokenResponse.status, errorText);
    return redirectToAppWithError("token_exchange_failed");
  }

  const tokenData: IntervalsTokenResponse = await tokenResponse.json();

  // Validate response
  if (!tokenData.access_token || !tokenData.athlete?.id) {
    console.error("Invalid token response:", tokenData);
    return redirectToAppWithError("invalid_response");
  }

  // Redirect to app with token (include state for client-side CSRF validation)
  return redirectToAppWithToken(tokenData, state);
}

/**
 * Redirect to app with successful token
 * Uses HTML page with JavaScript redirect since 302 redirects don't work for custom URL schemes
 */
function redirectToAppWithToken(token: IntervalsTokenResponse, state: string): Response {
  const params = new URLSearchParams({
    success: "true",
    access_token: token.access_token,
    token_type: token.token_type,
    scope: token.scope,
    athlete_id: token.athlete.id,
    athlete_name: token.athlete.name,
    state: state,
  });

  const redirectUrl = `${APP_SCHEME}://oauth/callback?${params.toString()}`;

  // Return HTML page that redirects to the app
  // 302 redirects don't work for custom URL schemes (veloq://)
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Redirecting to Veloq...</title>
  <meta http-equiv="refresh" content="0;url=${redirectUrl}">
</head>
<body>
  <p>Redirecting to Veloq...</p>
  <p>If you are not redirected automatically, <a href="${redirectUrl}">tap here</a>.</p>
  <script>window.location.href = "${redirectUrl}";</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

/**
 * Redirect to app with error
 * Uses HTML page with JavaScript redirect since 302 redirects don't work for custom URL schemes
 */
function redirectToAppWithError(error: string): Response {
  const params = new URLSearchParams({
    success: "false",
    error: error,
  });

  const redirectUrl = `${APP_SCHEME}://oauth/callback?${params.toString()}`;

  // Return HTML page that redirects to the app
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Redirecting to Veloq...</title>
  <meta http-equiv="refresh" content="0;url=${redirectUrl}">
</head>
<body>
  <p>Redirecting to Veloq...</p>
  <p>If you are not redirected automatically, <a href="${redirectUrl}">tap here</a>.</p>
  <script>window.location.href = "${redirectUrl}";</script>
</body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

// ---------------------------------------------------------------------------
// Push notification endpoints
// ---------------------------------------------------------------------------

/** Device token TTL: 90 days */
const DEVICE_TOKEN_TTL_SECONDS = 90 * 24 * 60 * 60;

/** Webhook events we process (others are ignored) */
const PROCESSED_EVENTS = new Set([
  "ACTIVITY_UPLOADED",
  "ACTIVITY_ANALYZED",
  "ACTIVITY_ACHIEVEMENTS",
  "FITNESS_UPDATED",
]);

/**
 * Register a device push token for an athlete.
 * Called after user opts in to notifications.
 * Body: { athleteId: string, token: string, platform: "ios" | "android" }
 */
async function handleDeviceRegister(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = (await request.json()) as {
      athleteId?: string;
      token?: string;
      platform?: string;
    };

    if (!body.athleteId || !body.token || !body.platform) {
      return jsonResponse({ error: "Missing required fields" }, 400);
    }

    if (body.platform !== "ios" && body.platform !== "android") {
      return jsonResponse({ error: "Invalid platform" }, 400);
    }

    const key = `athlete:${body.athleteId}`;
    const existing = await env.DEVICE_TOKENS.get(key, "json") as DeviceToken[] | null;
    const tokens: DeviceToken[] = existing ?? [];

    // Update existing token or add new one
    const idx = tokens.findIndex((t) => t.token === body.token);
    const entry: DeviceToken = {
      token: body.token,
      platform: body.platform as "ios" | "android",
      registeredAt: new Date().toISOString(),
    };

    if (idx >= 0) {
      tokens[idx] = entry;
    } else {
      tokens.push(entry);
    }

    // Store with TTL
    await env.DEVICE_TOKENS.put(key, JSON.stringify(tokens), {
      expirationTtl: DEVICE_TOKEN_TTL_SECONDS,
    });

    return jsonResponse({ success: true });
  } catch {
    return jsonResponse({ error: "Invalid request" }, 400);
  }
}

/**
 * Unregister a device push token.
 * Called on logout or when user disables notifications.
 * Body: { athleteId: string, token: string }
 */
async function handleDeviceUnregister(
  request: Request,
  env: Env
): Promise<Response> {
  try {
    const body = (await request.json()) as {
      athleteId?: string;
      token?: string;
    };

    if (!body.athleteId || !body.token) {
      return jsonResponse({ error: "Missing required fields" }, 400);
    }

    const key = `athlete:${body.athleteId}`;
    const existing = await env.DEVICE_TOKENS.get(key, "json") as DeviceToken[] | null;
    if (!existing) {
      return jsonResponse({ success: true }); // Already gone
    }

    const filtered = existing.filter((t) => t.token !== body.token);
    if (filtered.length === 0) {
      await env.DEVICE_TOKENS.delete(key);
    } else {
      await env.DEVICE_TOKENS.put(key, JSON.stringify(filtered), {
        expirationTtl: DEVICE_TOKEN_TTL_SECONDS,
      });
    }

    return jsonResponse({ success: true });
  } catch {
    return jsonResponse({ error: "Invalid request" }, 400);
  }
}

/**
 * Receive webhook events from intervals.icu.
 * Validates shared secret, looks up device tokens, sends silent push.
 *
 * intervals.icu payload format:
 * { secret: "...", events: [{ athlete_id, type, timestamp, activity?: {...} }] }
 */
async function handleIntervalsWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  if (!env.WEBHOOK_SECRET) {
    console.error("WEBHOOK_SECRET not configured");
    return jsonResponse({ error: "Server misconfigured" }, 500);
  }

  try {
    const payload = (await request.json()) as {
      secret?: string;
      events?: Array<{
        athlete_id?: string;
        type?: string;
        timestamp?: string;
        activity?: { id?: string };
      }>;
    };

    // Validate shared secret
    if (payload.secret !== env.WEBHOOK_SECRET) {
      console.error("Invalid webhook secret");
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    if (!payload.events || !Array.isArray(payload.events)) {
      return jsonResponse({ success: true }); // Nothing to process
    }

    // Process each event (with deduplication)
    const pushPromises: Promise<void>[] = [];

    for (const event of payload.events) {
      if (!event.athlete_id || !event.type) continue;
      if (!PROCESSED_EVENTS.has(event.type)) continue;

      // Deduplicate: skip if we already processed this event recently
      const dedupeKey = `dedup:${event.athlete_id}:${event.type}:${event.activity?.id ?? "none"}`;
      const alreadyProcessed = await env.OAUTH_STATES.get(dedupeKey);
      if (alreadyProcessed) continue;

      // Mark as processed (5-minute TTL)
      await env.OAUTH_STATES.put(dedupeKey, "1", { expirationTtl: 300 });

      // Look up device tokens for this athlete
      const key = `athlete:${event.athlete_id}`;
      const tokens = await env.DEVICE_TOKENS.get(key, "json") as DeviceToken[] | null;
      if (!tokens || tokens.length === 0) continue;

      // Send silent push to each device
      for (const device of tokens) {
        const pushData = {
          event_type: event.type,
          athlete_id: event.athlete_id,
          activity_id: event.activity?.id ?? null,
        };

        pushPromises.push(
          sendSilentPush(device, pushData, env).catch((err) => {
            console.error(`Push failed for ${device.platform}:`, err);
          })
        );
      }
    }

    // Fire all pushes in parallel
    await Promise.allSettled(pushPromises);

    return jsonResponse({ success: true });
  } catch (err) {
    console.error("Webhook processing error:", err);
    return jsonResponse({ error: "Processing failed" }, 500);
  }
}

/**
 * Send a data-only (silent) push notification.
 * iOS: content-available: 1, no alert
 * Android: data message, no notification field
 */
async function sendSilentPush(
  device: DeviceToken,
  data: Record<string, unknown>,
  env: Env
): Promise<void> {
  if (device.platform === "android") {
    await sendFcmPush(device.token, data, env);
  } else {
    await sendApnsPush(device.token, data, env);
  }
}

/**
 * Send push via FCM HTTP v1 API (Android).
 * Requires FCM_SERVICE_ACCOUNT_KEY secret.
 */
async function sendFcmPush(
  token: string,
  data: Record<string, unknown>,
  env: Env
): Promise<void> {
  if (!env.FCM_SERVICE_ACCOUNT_KEY) {
    console.warn("FCM_SERVICE_ACCOUNT_KEY not set, skipping Android push");
    return;
  }

  // TODO: Implement FCM HTTP v1 API call
  // This requires:
  //   1. Parse service account JSON
  //   2. Create JWT for OAuth2 token exchange
  //   3. Exchange JWT for access token
  //   4. POST to fcm.googleapis.com/v1/projects/{project}/messages:send
  //   5. Body: { message: { token, data: { ... } } }
  //
  // For now, log the intent. Implementation requires the service account
  // key to be configured in Cloudflare secrets.
  console.log(`FCM push queued for token ${token.substring(0, 8)}...`);
}

/**
 * Send push via APNs HTTP/2 (iOS).
 * Requires APNS_KEY_P8, APNS_KEY_ID, APNS_TEAM_ID secrets.
 */
async function sendApnsPush(
  token: string,
  data: Record<string, unknown>,
  env: Env
): Promise<void> {
  if (!env.APNS_KEY_P8 || !env.APNS_KEY_ID || !env.APNS_TEAM_ID) {
    console.warn("APNs credentials not set, skipping iOS push");
    return;
  }

  // TODO: Implement APNs HTTP/2 call
  // This requires:
  //   1. Create JWT from p8 key (ES256 algorithm)
  //   2. POST to api.push.apple.com/3/device/{token}
  //   3. Headers: authorization: bearer {jwt}, apns-push-type: background,
  //              apns-priority: 5, apns-topic: com.veloq.app
  //   4. Body: { aps: { "content-available": 1 }, ...data }
  //
  // For now, log the intent. Implementation requires the APNs key
  // to be configured in Cloudflare secrets.
  console.log(`APNs push queued for token ${token.substring(0, 8)}...`);
}

/** Helper to create JSON responses */
function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
