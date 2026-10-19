/**
 * Veloq API Worker - Cloudflare Worker
 *
 * Handles:
 *   1. OAuth token exchange for intervals.icu (existing)
 *   2. Webhook relay: receives intervals.icu webhooks, sends a data push to
 *      every device and, on iOS and a legacy Android token, a visible push
 *      beside it
 *   3. Device token management: register/unregister push tokens
 *   4. A scheduled check of the receipts for the pushes Expo accepted
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
import { dedupeKey, exchangeKey, type RateRoute, rateKey, stateKey } from "./keys";
import { authoriseDevice, type DeviceAuth, intervalsAthleteResolver } from "./deviceAuth";
import { isValidVerifier, newOpaqueToken, verifierMatches } from "./pkce";
import { buildPushMessages, pushDataFor } from "./pushMessages";
import {
  type ExpoOutcome,
  isSentPush,
  isUnregistered,
  pushRefusal,
  RECEIPT_BATCH,
  RECEIPT_PREFIX,
  RECEIPT_TTL_SECONDS,
  receiptKey,
  type SentPush,
  withoutToken,
} from "./pushReceipts";
import { webhookShapeLine } from "./webhookShape";

interface Env {
  INTERVALS_CLIENT_ID: string;
  INTERVALS_CLIENT_SECRET: string;
  OAUTH_STATES: KVNamespace;
  DEVICE_TOKENS: KVNamespace;
  WEBHOOK_SECRET?: string;
  /** Athlete whose deliveries are described in the log, unset between captures. */
  WEBHOOK_SHAPE_ATHLETE?: string;
}

interface DeviceToken {
  token: string;
  platform: "ios" | "android";
  registeredAt: string;
  /** Registered with no credential, by a build from before device verification. */
  legacy?: boolean;
}

const tokenOwnerKey = (token: string) => `token:${token}`;

/**
 * Whether a stored row is legacy. A row stored before the flag existed came
 * from a registration with no credential, so only an explicit `false` reads
 * as verified.
 */
function isLegacy(device: DeviceToken): boolean {
  return device.legacy !== false;
}

/**
 * Whether a device request carries no credential at all, which is how builds
 * from before device verification register and unregister. A header that is
 * present but unreadable is not this: it is refused as a bad credential.
 */
function carriesNoCredential(request: Request): boolean {
  const header = request.headers.get("Authorization");
  return header === null || header.trim() === "";
}

async function findTokenRow(
  env: Env,
  athleteId: string,
  token: string
): Promise<DeviceToken | null> {
  const rows = await env.DEVICE_TOKENS.get(`athlete:${athleteId}`, "json") as DeviceToken[] | null;
  return rows?.find((entry) => entry.token === token) ?? null;
}

function missingCredential(): Response {
  return jsonResponse({ error: "Missing credential" }, 401);
}

async function removeTokenFromAthlete(env: Env, athleteId: string, token: string): Promise<void> {
  const key = `athlete:${athleteId}`;
  const existing = await env.DEVICE_TOKENS.get(key, "json") as DeviceToken[] | null;
  if (!existing) return;

  const filtered = existing.filter((entry) => entry.token !== token);
  if (filtered.length === existing.length) return;
  if (filtered.length === 0) {
    await env.DEVICE_TOKENS.delete(key);
  } else {
    await env.DEVICE_TOKENS.put(key, JSON.stringify(filtered), {
      expirationTtl: DEVICE_TOKEN_TTL_SECONDS,
    });
  }
}

async function clearTokenOwner(env: Env, athleteId: string, token: string): Promise<void> {
  const key = tokenOwnerKey(token);
  if (await env.DEVICE_TOKENS.get(key) === athleteId) {
    await env.DEVICE_TOKENS.delete(key);
  }
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
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
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

      // Builds that named routes and sections from their places ask here for
      // the geocoder to use. The answer is a stop, so they send nothing.
      if (path === "/geocoder" && request.method === "GET") {
        return new Response(JSON.stringify({ endpoint: null }), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=86400",
          },
        });
      }

      // Register OAuth state (app calls this before starting OAuth flow)
      if (path === "/oauth/state" && request.method === "POST") {
        return await handleRegisterState(request, env);
      }

      // OAuth callback
      if (path === "/oauth/callback" && request.method === "GET") {
        return await handleOAuthCallback(url, env);
      }

      // Redeem the one-time code the callback redirected with
      if (path === "/oauth/token" && request.method === "POST") {
        return await handleTokenExchange(request, env);
      }

      // --- Push notification endpoints (additive, backwards-compatible) ---

      // Register device push token
      if (path === "/devices/register" && request.method === "POST") {
        return await handleDeviceRegister(request, env);
      }

      // Unregister device push token
      if (path === "/devices/unregister" && request.method === "DELETE") {
        return await handleDeviceUnregister(request, env);
      }

      // Webhook receiver for intervals.icu events
      if (path === "/webhook/intervals" && request.method === "POST") {
        return await handleIntervalsWebhook(request, env, ctx);
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error("Worker error:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },

  /** The cron trigger in `wrangler.toml`: read the receipts of recent pushes. */
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    await checkPushReceipts(env);
  },
};

/**
 * Check the rate limit for the client address on one route.
 * Returns true if the request should be allowed, false if rate limited.
 *
 * The count is read and written back without a transaction, so it is
 * approximate, and KV refuses a second write to one key inside a second. A
 * failing counter allows the request: refusing a valid sign-in because the
 * limiter could not count it costs more than one uncounted request.
 */
async function checkRateLimit(
  route: RateRoute,
  request: Request,
  env: Env
): Promise<boolean> {
  // Cloudflare sets this on every request; any other address header is the
  // client's own to choose.
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = rateKey(route, ip);
  try {
    const current = await env.OAUTH_STATES.get(key);
    const count = current ? parseInt(current, 10) : 0;
    if (count >= RATE_LIMIT_MAX_REQUESTS) {
      return false;
    }
    await env.OAUTH_STATES.put(key, String(count + 1), {
      expirationTtl: RATE_LIMIT_WINDOW_SECONDS,
    });
  } catch (error) {
    console.error("Rate limit counter failed, allowing the request:", error);
  }
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
  try {
    const allowed = await checkRateLimit("state", request, env);
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

    await env.OAUTH_STATES.put(stateKey(state), stored, {
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
 * Parks intervals.icu's code for the app to redeem, then redirects to it
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

  // A KV error here is answered in the app like any other failure. Thrown
  // past this handler it reached the outer catch, whose plain 500 leaves the
  // auth browser with no way back to the app.
  let storedState: string | null;
  try {
    storedState = await env.OAUTH_STATES.get(stateKey(state));
    if (storedState) {
      // Delete state after validation (single use)
      await env.OAUTH_STATES.delete(stateKey(state));
    }
  } catch (error) {
    console.error("OAuth state lookup failed:", error);
    return redirectToAppWithError("server_error");
  }
  if (!storedState) {
    console.error(
      "OAuth state not found or expired:",
      state.substring(0, 8) + "..."
    );
    return redirectToAppWithError("invalid_state");
  }

  const challenge = challengeFromStoredState(storedState);

  // A client that registered a challenge gets the token at redemption, so only
  // intervals.icu's own code waits here, and the worker holds no bearer token.
  if (challenge) {
    try {
      const exchangeCode = newOpaqueToken();
      await env.OAUTH_STATES.put(
        exchangeKey(exchangeCode),
        JSON.stringify({ challenge, code }),
        { expirationTtl: EXCHANGE_CODE_TTL_SECONDS }
      );
      return redirectToAppWithCode(exchangeCode, state);
    } catch (error) {
      console.error("Parking the code failed:", error);
      return redirectToAppWithError("server_error");
    }
  }

  // An older build registered no challenge and cannot redeem a code, so it
  // still gets the token in the URL.
  try {
    const tokenData = await exchangeCodeForToken(code, env);
    if (!tokenData) return redirectToAppWithError("token_exchange_failed");
    return redirectToAppWithLegacyToken(tokenData, state);
  } catch (error) {
    console.error("Token exchange failed:", error);
    return redirectToAppWithError("token_exchange_failed");
  }
}

/**
 * Post intervals.icu's code with the client credentials. Null when the answer
 * is not ok or lacks the token or athlete id. Only the shape of a bad answer
 * is logged, since it may still carry the access token.
 */
async function exchangeCodeForToken(
  code: string,
  env: Env
): Promise<IntervalsTokenResponse | null> {
  const formData = new URLSearchParams({
    client_id: env.INTERVALS_CLIENT_ID,
    client_secret: env.INTERVALS_CLIENT_SECRET,
    code,
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
    return null;
  }

  const tokenData: IntervalsTokenResponse = await tokenResponse.json();
  if (!tokenData.access_token || !tokenData.athlete?.id) {
    console.error("Invalid token response, keys:", Object.keys(tokenData));
    return null;
  }
  return tokenData;
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

/**
 * Redeem a one-time code for the token it stands for. The worker exchanges
 * intervals.icu's parked code only once the verifier has matched, so it never
 * holds the token between requests.
 *
 * The code alone is not enough and that is the whole point: whoever presents it
 * has to produce the verifier the challenge was made from, and only the app that
 * started the flow has ever held it. The entry is deleted before the token goes
 * out, so a code works once whatever happens next.
 */
async function handleTokenExchange(request: Request, env: Env): Promise<Response> {
  if (!(await checkRateLimit("token", request, env))) {
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

  let parsed: { challenge?: unknown; code?: unknown };
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

  // An entry parked before the token moved to redemption has no code.
  if (typeof parsed.code !== "string" || parsed.code.length === 0) {
    return exchangeRefused("invalid_grant");
  }

  let token: IntervalsTokenResponse | null;
  try {
    token = await exchangeCodeForToken(parsed.code, env);
  } catch (error) {
    console.error("Token exchange failed:", error);
    token = null;
  }
  if (!token) {
    return new Response(JSON.stringify({ error: "token_exchange_failed" }), {
      status: 502,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-store",
      },
    });
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
 * webhook path also reactively prunes tokens Expo flags as
 * DeviceNotRegistered. This cap is a backstop for the case where no webhooks
 * fire.
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
 * notification. iOS is sent it, and the iOS notification service extension
 * rewrites the generic text in place with enriched content. A legacy Android
 * token is sent it as the only entry its build draws. A verified Android token
 * gets the data push alone, so a force-stopped Android package shows nothing
 * until the app is opened. Returns null for events that shouldn't
 * surface a tray entry on their own (wellness/fitness updates are
 * background-only).
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
 * resolve to the athlete the body names. A request with none is a build from
 * before device verification: it is accepted unverified and the row is
 * flagged legacy, unless a verified row already holds the token, which a
 * credential-less request never displaces.
 */
async function handleDeviceRegister(
  request: Request,
  env: Env
): Promise<Response> {
  // Spent before the credential is forwarded to intervals.icu, so no address
  // can make the proxy send lookups at any volume.
  if (!(await checkRateLimit("device-register", request, env))) {
    return deviceRateLimited();
  }
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

    const legacy = carriesNoCredential(request);
    if (!legacy) {
      const auth = await authoriseDevice(
        request.headers.get("Authorization"),
        body.athleteId,
        intervalsAthleteResolver()
      );
      if (!auth.ok) {
        return deviceAuthRefusal(auth);
      }
    }

    const ownerKey = tokenOwnerKey(body.token);
    const previousAthlete = await env.DEVICE_TOKENS.get(ownerKey);
    if (legacy) {
      for (const holder of new Set([body.athleteId, previousAthlete])) {
        if (!holder) continue;
        const row = await findTokenRow(env, holder, body.token);
        if (row && !isLegacy(row)) return missingCredential();
      }
    }
    if (previousAthlete && previousAthlete !== body.athleteId) {
      await removeTokenFromAthlete(env, previousAthlete, body.token);
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
      legacy,
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
      const dropped = tokens.splice(0, tokens.length - MAX_TOKENS_PER_ATHLETE);
      for (const entry of dropped) {
        await clearTokenOwner(env, body.athleteId, entry.token);
      }
    }

    // Store with TTL
    await env.DEVICE_TOKENS.put(key, JSON.stringify(tokens), {
      expirationTtl: DEVICE_TOKEN_TTL_SECONDS,
    });
    if (tokens.some((entry) => entry.token === body.token)) {
      await env.DEVICE_TOKENS.put(ownerKey, body.athleteId, {
        expirationTtl: DEVICE_TOKEN_TTL_SECONDS,
      });
    }

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
 * resolve to the athlete the body names. A request with none may remove a
 * legacy row only.
 */
async function handleDeviceUnregister(
  request: Request,
  env: Env
): Promise<Response> {
  // Its own budget, so registrations that spent theirs still let the
  // unregister at sign-out through.
  if (!(await checkRateLimit("device-unregister", request, env))) {
    return deviceRateLimited();
  }
  try {
    const body = (await request.json()) as {
      athleteId?: string;
      token?: string;
    };

    if (!body.athleteId || !body.token) {
      return jsonResponse({ error: "Missing required fields" }, 400);
    }

    if (carriesNoCredential(request)) {
      const row = await findTokenRow(env, body.athleteId, body.token);
      if (row && !isLegacy(row)) return missingCredential();
    } else {
      const auth = await authoriseDevice(
        request.headers.get("Authorization"),
        body.athleteId,
        intervalsAthleteResolver()
      );
      if (!auth.ok) {
        return deviceAuthRefusal(auth);
      }
    }

    await removeTokenFromAthlete(env, body.athleteId, body.token);
    await clearTokenOwner(env, body.athleteId, body.token);

    return jsonResponse({ success: true });
  } catch {
    return jsonResponse({ error: "Invalid request" }, 400);
  }
}

/**
 * Receive webhook events from intervals.icu.
 * Validates shared secret, looks up device tokens, sends each a data push and,
 * on iOS, a visible push for an activity event.
 *
 * intervals.icu payload format:
 * { secret: "...", events: [{ athlete_id, type, timestamp, activity?: {...} }] }
 */
async function handleIntervalsWebhook(
  request: Request,
  env: Env,
  ctx?: ExecutionContext
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

    const shape = webhookShapeLine(payload, new Date().toISOString(), env.WEBHOOK_SHAPE_ATHLETE);
    if (shape) console.log(shape);

    if (!payload.events || !Array.isArray(payload.events)) {
      return jsonResponse({ success: true }); // Nothing to process
    }

    // An event is claimed as seen before its pushes go out, so a redelivery
    // racing this one sends nothing twice. A failure before any push is sent
    // releases the claim, so the sender's retry delivers that event, and only
    // fails that event: the others in the batch still go out and stay seen.
    // The response waits for every push and prune, so returning cancels none.
    const skipDedupe = (payload as { skip_dedupe?: boolean }).skip_dedupe === true;
    const deliveries: Promise<void>[] = [];
    let failed = 0;

    for (const event of payload.events) {
      if (!event.athlete_id || !event.type) continue;
      if (!PROCESSED_EVENTS.has(event.type)) continue;
      try {
        const sent = await startEventPushes(
          env,
          {
            athlete_id: event.athlete_id,
            type: event.type,
            timestamp: event.timestamp,
            activity: event.activity,
          },
          skipDedupe
        );
        if (sent) deliveries.push(sent);
      } catch (err) {
        failed += 1;
        console.error(`Webhook event ${event.type} failed:`, err);
      }
    }

    const settled = Promise.allSettled(deliveries);
    ctx?.waitUntil(settled);
    await settled;

    if (failed > 0) {
      return jsonResponse({ error: "Processing failed" }, 500);
    }
    return jsonResponse({ success: true });
  } catch (err) {
    console.error("Webhook processing error:", err);
    return jsonResponse({ error: "Processing failed" }, 500);
  }
}

/**
 * Claim one webhook event and start its pushes. Returns the promise of the
 * pushes and the dead-token prune behind them, or null when there is nothing
 * to send. Throws when the event could not be started, after releasing its
 * claim so a redelivery is not skipped as already processed.
 */
async function startEventPushes(
  env: Env,
  event: { athlete_id: string; type: string; timestamp?: string; activity?: { id?: string } },
  skipDedupe: boolean
): Promise<Promise<void> | null> {
  const athleteId = event.athlete_id;

  // Deduplicate: skip if we already processed this event recently.
  // Bypass with `"skip_dedupe": true` at the top of the webhook body for
  // test iteration (curl loop against the same activity_id).
  const seen = skipDedupe ? null : dedupeKey(athleteId, event.type, event.activity?.id, event.timestamp);
  if (seen) {
    if (await env.OAUTH_STATES.get(seen)) return null;
    await env.OAUTH_STATES.put(seen, "1", { expirationTtl: 300 });
  }

  // Look up device tokens for this athlete
  const key = `athlete:${athleteId}`;
  let tokens: DeviceToken[] | null;
  try {
    tokens = await env.DEVICE_TOKENS.get(key, "json") as DeviceToken[] | null;
  } catch (err) {
    if (seen) await env.OAUTH_STATES.delete(seen).catch(() => {});
    throw err;
  }
  if (!tokens || tokens.length === 0) return null;

  // The visible title and body go to iOS, where the notification service
  // extension rewrites them in place, and to a legacy Android token, whose
  // build draws nothing else. `buildPushMessages` drops them for a verified
  // Android token: there the OS draws the placeholder under a tag of its own
  // and the native worker's entry stands beside it rather than replacing it.
  // The data payload wakes the handler on both, which posts the enriched
  // notification itself.
  const pushData = pushDataFor(event);
  const visible = visibleContentForEvent(event.type, event.activity?.id);
  const perDeviceResults = tokens.map((device) =>
    sendExpoPush(
      env,
      { athleteId, token: device.token, platform: device.platform, legacy: isLegacy(device) },
      pushData,
      visible
    )
      .then((alive) => ({ token: device.token, alive }))
      .catch((err) => {
        console.error(`Push failed for ${device.platform}:`, err);
        // Transient transport error, keep the token (don't prune).
        return { token: device.token, alive: true };
      })
  );

  // The prune runs once this athlete's pushes settle. The pushes have gone
  // out by then, so a failed prune leaves the event seen: the dead token
  // reports itself again on the next push.
  return (async () => {
    const results = await Promise.all(perDeviceResults);
    const dead = results.filter((r) => !r.alive).map((r) => r.token);
    await pruneDeadTokens(env, athleteId, dead);
  })().catch((err) => {
    console.error("Dead-token prune failed:", err);
  });
}

/** Remove tokens Expo reported unregistered from one athlete's row. */
async function pruneDeadTokens(env: Env, athleteId: string, dead: string[]): Promise<void> {
  if (dead.length === 0) return;
  const key = `athlete:${athleteId}`;
  const latest = await env.DEVICE_TOKENS.get(key, "json") as DeviceToken[] | null;
  const surviving = (latest ?? []).filter((t) => !dead.includes(t.token));
  if (surviving.length === 0) {
    await env.DEVICE_TOKENS.delete(key);
  } else {
    await env.DEVICE_TOKENS.put(key, JSON.stringify(surviving), {
      expirationTtl: DEVICE_TOKEN_TTL_SECONDS,
    });
  }
  for (const token of dead) {
    await clearTokenOwner(env, athleteId, token);
  }
  console.log(`Pruned ${dead.length} dead token(s) (${surviving.length} remain)`);
}

/**
 * Send one or two pushes for an event via Expo Push Service. Expo handles FCM
 * (Android) and APNs (iOS) routing transparently, with the platform
 * credentials held on the Expo project.
 *
 * With `visible` on iOS or a legacy Android token, a tray push goes first and a
 * silent data push behind it. Without `visible`, or on a verified Android
 * token, only the silent one. The visible push
 * carries generic text the caller wrote and, for an activity event, a `route`
 * the device reads when the notification is tapped. The silent push carries
 * event_type and activity_id. No personal data is in either.
 *
 * A refused ticket is logged, and an accepted one is kept for the receipt
 * check. Returns true if the token is still alive on Expo's side, false if
 * Expo reported DeviceNotRegistered (caller should remove the token from KV).
 */
async function sendExpoPush(
  env: Env,
  device: SentPush,
  data: Record<string, unknown>,
  visible: { title: string; body: string } | null
): Promise<boolean> {
  const messages = buildPushMessages(device.token, data, visible, device.platform, device.legacy);

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
      console.error(
        `Expo push failed (${response.status}) for ${device.platform}: ${withoutToken(body, device.token)}`
      );
      continue; // transport error, don't prune on transient failures
    }

    let ticket: ExpoOutcome | undefined;
    try {
      ticket = (JSON.parse(body) as { data?: ExpoOutcome }).data;
    } catch {
      // unparseable body, assume alive
    }
    if (!ticket) {
      console.error(`Expo push answered with no ticket for ${device.platform}`);
      continue;
    }

    const refusal = pushRefusal("ticket", ticket, device);
    if (refusal) console.error(refusal);
    if (isUnregistered(ticket)) alive = false;
    if (ticket.status === "ok" && ticket.id) await keepForReceipt(env, ticket.id, device);
  }

  return alive;
}

/**
 * Keep an accepted push until its receipt is read. The token and athlete ride
 * in the key's metadata, which a list returns, so a receipt naming an
 * unregistered device can be pruned. A failed write loses one receipt only.
 */
async function keepForReceipt(env: Env, ticketId: string, device: SentPush): Promise<void> {
  try {
    await env.DEVICE_TOKENS.put(receiptKey(ticketId), "", {
      expirationTtl: RECEIPT_TTL_SECONDS,
      metadata: device,
    });
  } catch (err) {
    console.error(`Could not keep a ${device.platform} push for its receipt:`, err);
  }
}

/**
 * Read the receipts of the pushes Expo accepted, log every refusal and prune a
 * device Apple or Google reports gone. A receipt not ready yet stays for the
 * next run, and so does every push in a request that failed: only a receipt
 * read is let go.
 */
async function checkPushReceipts(env: Env): Promise<void> {
  const waiting = new Map<string, SentPush>();
  let cursor: string | undefined;
  do {
    const page = await env.DEVICE_TOKENS.list<unknown>({ prefix: RECEIPT_PREFIX, cursor });
    for (const entry of page.keys) {
      if (isSentPush(entry.metadata)) {
        waiting.set(entry.name.slice(RECEIPT_PREFIX.length), entry.metadata);
      } else {
        await env.DEVICE_TOKENS.delete(entry.name);
      }
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);

  const pending = [...waiting.entries()];
  const dead = new Map<string, string[]>();
  for (let start = 0; start < pending.length; start += RECEIPT_BATCH) {
    const batch = pending.slice(start, start + RECEIPT_BATCH);
    const receipts = await fetchReceipts(batch.map(([id]) => id));
    if (!receipts) continue;
    for (const [id, sent] of batch) {
      const receipt = receipts[id];
      if (!receipt) continue;
      const refusal = pushRefusal("receipt", receipt, sent);
      if (refusal) console.error(refusal);
      if (isUnregistered(receipt)) {
        dead.set(sent.athleteId, [...(dead.get(sent.athleteId) ?? []), sent.token]);
      }
      await env.DEVICE_TOKENS.delete(receiptKey(id));
    }
  }

  for (const [athleteId, tokens] of dead) {
    try {
      await pruneDeadTokens(env, athleteId, tokens);
    } catch (err) {
      console.error("Dead-token prune after a receipt failed:", err);
    }
  }
}

/** One receipt request, or null when it failed and the ids wait for the next run. */
async function fetchReceipts(ids: string[]): Promise<Record<string, ExpoOutcome> | null> {
  try {
    const response = await fetch("https://exp.host/--/api/v2/push/getReceipts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ ids }),
    });
    if (!response.ok) {
      console.error(`Expo receipt request failed (${response.status})`);
      return null;
    }
    const parsed = (await response.json()) as { data?: Record<string, ExpoOutcome> };
    return parsed.data ?? null;
  } catch (err) {
    console.error("Expo receipt request failed:", err);
    return null;
  }
}

/** Helper to create JSON responses */
/** A device request that proved nothing, with intervals.icu's wait on a 429. */
function deviceAuthRefusal(auth: Exclude<DeviceAuth, { ok: true }>): Response {
  const response = jsonResponse({ error: auth.error }, auth.status);
  if (auth.status === 429 && auth.retryAfter) {
    response.headers.set("Retry-After", auth.retryAfter);
  }
  return response;
}

function deviceRateLimited(): Response {
  const response = jsonResponse({ error: "Too many requests" }, 429);
  response.headers.set("Retry-After", String(RATE_LIMIT_WINDOW_SECONDS));
  return response;
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
