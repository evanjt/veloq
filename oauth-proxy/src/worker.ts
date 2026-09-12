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
 */

import { secretsMatch } from "./secrets";
import { authoriseDevice, intervalsAthleteResolver } from "./deviceAuth";
import { isValidVerifier, newOpaqueToken, verifierMatches } from "./pkce";

interface Env {
  INTERVALS_CLIENT_ID: string;
  INTERVALS_CLIENT_SECRET: string;
  OAUTH_STATES: KVNamespace;
  DEVICE_TOKENS: KVNamespace;
  WEBHOOK_SECRET?: string;
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
// A code is redeemed by the app the moment the deep link arrives, so the
// window it is worth anything in is the redirect itself.
const EXCHANGE_CODE_TTL_SECONDS = 120;

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

      // Redeem the one-time code the callback redirected with
      if (path === "/oauth/token" && request.method === "POST") {
        return handleTokenExchange(request, env);
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
    const body = (await request.json()) as {
      state?: string;
      code_challenge?: string;
    };
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

    // The challenge arrives here, over HTTPS, before the browser opens. That is
    // what makes it a proof: the app is the only party that has ever held the
    // verifier behind it, so the code the redirect carries is redeemable by the
    // app alone. An older build sends no challenge and gets the pre-PKCE
    // redirect, which is the only reason this field is optional.
    const challenge = body.code_challenge;
    const stored =
      typeof challenge === "string" && challenge.length > 0
        ? JSON.stringify({ challenge })
        : "valid";

    await env.OAUTH_STATES.put(state, stored, {
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

  const challenge = challengeFromStoredState(storedState);

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

  // Redirect to app with the one-time code (include state for client-side CSRF
  // validation). An older build registered no challenge and cannot redeem a
  // code, so it still gets the token in the URL.
  if (!challenge) {
    return redirectToAppWithLegacyToken(tokenData, state);
  }

  const exchangeCode = newOpaqueToken();
  await env.OAUTH_STATES.put(
    exchangeKey(exchangeCode),
    JSON.stringify({ challenge, token: tokenData }),
    { expirationTtl: EXCHANGE_CODE_TTL_SECONDS }
  );
  return redirectToAppWithCode(exchangeCode, state);
}

/**
 * The challenge the app registered with its state, or null when it registered
 * none. Pre-PKCE builds stored the literal "valid".
 */
function challengeFromStoredState(storedState: string): string | null {
  if (storedState === "valid") return null;
  try {
    const parsed = JSON.parse(storedState) as { challenge?: unknown };
    return typeof parsed.challenge === "string" && parsed.challenge.length > 0
      ? parsed.challenge
      : null;
  } catch {
    return null;
  }
}

/** Where a pending exchange lives. Namespaced so it cannot be read as a state. */
function exchangeKey(code: string): string {
  return `exchange:${code}`;
}

/**
 * Redeem a one-time code for the token it stands for.
 *
 * The code alone is not enough and that is the whole point: whoever presents it
 * has to produce the verifier the challenge was made from, and only the app that
 * started the flow has ever held it. The entry is deleted before the token goes
 * out, so a code works once whatever happens next.
 */
async function handleTokenExchange(request: Request, env: Env): Promise<Response> {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!(await checkRateLimit(ip, env))) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        "Retry-After": String(RATE_LIMIT_WINDOW_SECONDS),
      },
    });
  }

  let body: { code?: unknown; code_verifier?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return exchangeRefused("invalid_request");
  }

  const code = body.code;
  if (typeof code !== "string" || code.length === 0) {
    return exchangeRefused("invalid_request");
  }
  if (!isValidVerifier(body.code_verifier)) {
    return exchangeRefused("invalid_request");
  }

  const pending = await env.OAUTH_STATES.get(exchangeKey(code));
  if (!pending) {
    return exchangeRefused("invalid_grant");
  }

  let parsed: { challenge?: unknown; token?: IntervalsTokenResponse };
  try {
    parsed = JSON.parse(pending) as typeof parsed;
  } catch {
    await env.OAUTH_STATES.delete(exchangeKey(code));
    return exchangeRefused("invalid_grant");
  }

  // Single use, and spent before the answer is known: a wrong verifier must not
  // leave the code standing for another attempt.
  await env.OAUTH_STATES.delete(exchangeKey(code));

  if (!(await verifierMatches(body.code_verifier, parsed.challenge))) {
    console.error("Code exchange verifier did not match the challenge");
    return exchangeRefused("invalid_grant");
  }

  const token = parsed.token;
  if (!token?.access_token || !token.athlete?.id) {
    return exchangeRefused("invalid_grant");
  }

  return new Response(
    JSON.stringify({
      success: true,
      access_token: token.access_token,
      token_type: token.token_type,
      scope: token.scope,
      athlete_id: token.athlete.id,
      athlete_name: token.athlete.name,
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        // A bearer token is never worth holding anywhere on the way back.
        "Cache-Control": "no-store",
      },
    }
  );
}

/**
 * One wording for every refusal. Saying which part was wrong tells a caller
 * working through stolen codes whether the code or the verifier was the miss.
 */
function exchangeRefused(error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status: 400,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/**
 * Hand the browser back to the app.
 *
 * A 302 to a custom scheme does not open the app, so this is an HTML page that
 * navigates to it instead. All three redirects go through here, so there is one
 * copy of that page rather than three.
 */
function appRedirect(params: URLSearchParams): Response {
  const redirectUrl = `${APP_SCHEME}://oauth/callback?${params.toString()}`;
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
 * Redirect to the app with the one-time code.
 *
 * Nothing here is worth intercepting. Android's `singleTask` launch mode hands
 * this URL to any installed app that registers the `veloq` scheme, and before
 * the code existed that meant handing over the bearer token on every sign-in.
 */
function redirectToAppWithCode(code: string, state: string): Response {
  return appRedirect(
    new URLSearchParams({ success: "true", code: code, state: state })
  );
}

/**
 * The pre-PKCE redirect, for a build that registered no challenge and so has
 * nothing to redeem a code with. It puts the token in the URL, which is the
 * defect itself, and it is reachable only for those builds. Delete it once no
 * supported version still asks for it.
 */
function redirectToAppWithLegacyToken(
  token: IntervalsTokenResponse,
  state: string
): Response {
  const params = new URLSearchParams({
    success: "true",
    access_token: token.access_token,
    token_type: token.token_type,
    scope: token.scope,
    athlete_id: token.athlete.id,
    athlete_name: token.athlete.name,
    state: state,
  });

  return appRedirect(params);
}

/** Redirect to the app with the reason the flow did not complete. */
function redirectToAppWithError(error: string): Response {
  const params = new URLSearchParams({
    success: "false",
    error: error,
  });

  return appRedirect(params);
}

// ---------------------------------------------------------------------------
// Push notification endpoints
// ---------------------------------------------------------------------------

/** Device token TTL: 30 days (re-registered on every app open) */
const DEVICE_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/**
 * Soft cap on tokens stored per athlete. A real user has at most a handful
 * of devices (phone, tablet, maybe a watch companion). Anything beyond this
 * is almost certainly token rotation noise from dev/release reinstalls. The
 * webhook path also reactively prunes tokens Expo flags as DeviceNotRegistered
 *, this cap is a backstop for the case where no webhooks fire.
 */
const MAX_TOKENS_PER_ATHLETE = 10;

/** Webhook events we process (others are ignored) */
const PROCESSED_EVENTS = new Set([
  "ACTIVITY_UPLOADED",
  "ACTIVITY_ANALYZED",
  "ACTIVITY_ACHIEVEMENTS",
  "FITNESS_UPDATED",
  "WELLNESS_UPDATED",
  "SPORT_SETTINGS_UPDATED",
]);

/**
 * Build the visible portion of the push for events that warrant a tray
 * notification even when the app is in FLAG_STOPPED. The text is generic,
 * the on-device task replaces it with enriched content (PR detection, etc.)
 * when the app is alive. Returns null for events that shouldn't surface a
 * tray entry on their own (wellness/fitness updates are background-only).
 */
function visibleContentForEvent(
  type: string,
  activityId: string | undefined
): { title: string; body: string } | null {
  if (type === "ACTIVITY_UPLOADED" || type === "ACTIVITY_ANALYZED") {
    return {
      title: "Activity Recorded",
      body: activityId ? "New activity received" : "New activity synced",
    };
  }
  return null;
}

/**
 * Register a device push token for an athlete.
 * Called after user opts in to notifications.
 * Body: { athleteId: string, token: string, platform: "ios" | "android" }
 * Authorization: the caller's own intervals.icu credential, which has to
 * resolve to the athlete the body names.
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

    const auth = await authoriseDevice(
      request.headers.get("Authorization"),
      body.athleteId,
      intervalsAthleteResolver()
    );
    if (!auth.ok) {
      return jsonResponse({ error: auth.error }, auth.status);
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

    // Hard cap to protect against runaway accumulation if reactive pruning
    // (DeviceNotRegistered cleanup in the webhook path) hasn't run for a
    // while. Multi-device users are unaffected, typical case is 1–3 real
    // devices. Drop the oldest by registeredAt when the cap is exceeded.
    if (tokens.length > MAX_TOKENS_PER_ATHLETE) {
      tokens.sort((a, b) => a.registeredAt.localeCompare(b.registeredAt));
      tokens.splice(0, tokens.length - MAX_TOKENS_PER_ATHLETE);
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
 * Called on logout or when user disables notifications, so it runs before the
 * credential is cleared.
 * Body: { athleteId: string, token: string }
 * Authorization: the caller's own intervals.icu credential, which has to
 * resolve to the athlete the body names.
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

    const auth = await authoriseDevice(
      request.headers.get("Authorization"),
      body.athleteId,
      intervalsAthleteResolver()
    );
    if (!auth.ok) {
      return jsonResponse({ error: auth.error }, auth.status);
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
      events?: {
        athlete_id?: string;
        type?: string;
        timestamp?: string;
        activity?: { id?: string };
      }[];
    };

    // Validate shared secret. The route is public, so the comparison must not
    // say how much of a guess was right.
    if (!(await secretsMatch(payload.secret, env.WEBHOOK_SECRET))) {
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

      // Deduplicate: skip if we already processed this event recently.
      // Bypass with `"skip_dedupe": true` at the top of the webhook body for
      // test iteration (curl loop against the same activity_id).
      const skipDedupe = (payload as { skip_dedupe?: boolean }).skip_dedupe === true;
      if (!skipDedupe) {
        const dedupeKey = `dedup:${event.athlete_id}:${event.type}:${event.activity?.id ?? "none"}`;
        const alreadyProcessed = await env.OAUTH_STATES.get(dedupeKey);
        if (alreadyProcessed) continue;
        await env.OAUTH_STATES.put(dedupeKey, "1", { expirationTtl: 300 });
      }

      // Look up device tokens for this athlete
      const key = `athlete:${event.athlete_id}`;
      const tokens = await env.DEVICE_TOKENS.get(key, "json") as DeviceToken[] | null;
      if (!tokens || tokens.length === 0) continue;

      // Send hybrid visible+data push to each device. Visible title/body lets
      // the OS display a notification even when the app is in FLAG_STOPPED
      // (force-stopped, OEM-hibernated, or freshly installed), those apps
      // cannot receive any broadcast, including silent data-only pushes. When
      // the app IS alive the data payload still wakes the background task,
      // which re-schedules the notification with enriched content via the
      // same per-activity identifier (`activity-${activityId}`).
      const pushData = {
        event_type: event.type,
        athlete_id: event.athlete_id,
        activity_id: event.activity?.id ?? null,
        sent_at: Date.now(),
      };
      const visible = visibleContentForEvent(event.type, event.activity?.id);
      const perDeviceResults = tokens.map((device) =>
        sendExpoPush(device.token, pushData, visible, device.platform)
          .then((alive) => ({ token: device.token, alive }))
          .catch((err) => {
            console.error(`Push failed for ${device.platform}:`, err);
            // Transient transport error, keep the token (don't prune).
            return { token: device.token, alive: true };
          })
      );

      // Schedule the prune after this athlete's pushes settle. Captured
      // locally so it doesn't await the outer pushPromises array.
      pushPromises.push(
        (async () => {
          const results = await Promise.all(perDeviceResults);
          const dead = results.filter((r) => !r.alive).map((r) => r.token);
          if (dead.length === 0) return;
          const surviving = tokens.filter((t) => !dead.includes(t.token));
          if (surviving.length === 0) {
            await env.DEVICE_TOKENS.delete(key);
          } else {
            await env.DEVICE_TOKENS.put(key, JSON.stringify(surviving), {
              expirationTtl: DEVICE_TOKEN_TTL_SECONDS,
            });
          }
          console.log(
            `Pruned ${dead.length} dead token(s) from ${key} (${surviving.length} remain)`
          );
        })()
      );
    }

    // Wait for all per-athlete prune blocks (which themselves wait on pushes)
    await Promise.allSettled(pushPromises);

    return jsonResponse({ success: true });
  } catch (err) {
    console.error("Webhook processing error:", err);
    return jsonResponse({ error: "Processing failed" }, 500);
  }
}

/**
 * Send one or two pushes for an event via Expo Push Service. Expo handles FCM
 * (Android) and APNs (iOS) routing transparently. No Firebase project or APNs
 * key required. Expo Push is free.
 *
 * With `visible`, a tray push goes first and a silent data push behind it, for
 * the reason set out below; without it, only the silent one. The visible push
 * carries generic text the caller wrote and, for an activity event, a `route`
 * the device reads when the notification is tapped. The silent push carries
 * event_type and activity_id. No personal data is in either.
 *
 * Returns true if the token is still alive on Expo's side, false if Expo
 * reported DeviceNotRegistered (caller should remove the token from KV).
 */
async function sendExpoPush(
  token: string,
  data: Record<string, unknown>,
  visible: { title: string; body: string } | null,
  platform?: string
): Promise<boolean> {
  const channelId = "veloq-insights";

  // On Android, Expo maps title/body → FCM `notification` block (auto-displayed
  // by the OS, app never invoked) and data-only → FCM `data` block (delivered
  // to ExpoFirebaseMessagingService → wakes our TaskManager task). These are
  // mutually exclusive per FCM message. To get both a tray entry when the app
  // is stopped AND a background wake when the app is warm, send two pushes:
  //   1. Visible push: always-on tray entry, generic text. OS handles it.
  //   2. Silent data push: wakes the task so it can enrich the notification
  //      by replacing the visible one in place via activity-${activityId} tag.
  // When the app is FLAG_STOPPED the silent push is dropped by the OS and
  // only the visible one shows, exactly what we want.
  const activityId = typeof data.activity_id === "string" ? data.activity_id : null;

  const messages: Record<string, unknown>[] = [];

  if (visible) {
    // Include deep-link data on the VISIBLE push too. Expo forwards this
    // `data` field as FCM notification message extras, which the
    // NotificationResponseHandler on the device reads from
    // response.notification.request.content.data when the user taps.
    // Without this, tapping just opens MainActivity with no deep-link
    // context and the user lands on Home instead of the activity.
    const tapData = activityId
      ? {
          activityId,
          route: `/activity/${activityId}`,
          ...data,
        }
      : data;

    messages.push({
      to: token,
      title: visible.title,
      body: visible.body,
      data: tapData,
      priority: "high",
      channelId,
    });
  }

  // Silent data-only push: no title, body, channelId, sound, or any field
  // that would make Expo emit an FCM notification message. We want a pure
  // `data` FCM message so ExpoFirebaseMessagingService delivers it to the
  // TaskManager task instead of the OS rendering a blank tray entry.
  // iOS: APNs requires apns-priority 5 for content-available background
  // pushes, "high" (10) risks throttling or silent drops. Expo derives
  // apns-push-type: background from _contentAvailable. Android keeps high
  // priority so aggressive OEMs deliver the data message promptly.
  messages.push({
    to: token,
    data,
    priority: platform === "ios" ? "normal" : "high",
    _contentAvailable: true,
  });

  let alive = true;
  for (const payload of messages) {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const body = await response.text();
    if (!response.ok) {
      console.error(`Expo push failed (${response.status}): ${body}`);
      continue; // transport error, don't prune on transient failures
    }

    console.log(`Expo push ok: ${body}`);
    try {
      const parsed = JSON.parse(body) as {
        data?: { status?: string; details?: { error?: string } };
      };
      if (
        parsed.data?.status === "error" &&
        parsed.data?.details?.error === "DeviceNotRegistered"
      ) {
        alive = false;
      }
    } catch {
      // unparseable body, assume alive
    }
  }

  return alive;
}

/** Helper to create JSON responses */
function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
