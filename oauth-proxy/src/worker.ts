/**
 * Veloq OAuth Proxy - Cloudflare Worker
 *
 * Handles OAuth token exchange for intervals.icu.
 * See README.md for deployment instructions.
 *
 * Environment:
 * - INTERVALS_CLIENT_ID: OAuth client ID
 * - INTERVALS_CLIENT_SECRET: OAuth client secret
 * - OAUTH_STATES: KV namespace for CSRF state validation
 */

interface Env {
  INTERVALS_CLIENT_ID: string;
  INTERVALS_CLIENT_SECRET: string;
  OAUTH_STATES: KVNamespace;
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

const INTERVALS_TOKEN_URL = "https://intervals.icu/api/oauth/token";
const APP_SCHEME = "veloq";
/** State parameter TTL in seconds (5 minutes - OAuth code expires in 2 min) */
const STATE_TTL_SECONDS = 300;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // Add CORS headers for preflight requests
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
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

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error("Worker error:", error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
};

/**
 * Register a state parameter for CSRF protection
 * App calls this before starting OAuth flow
 */
async function handleRegisterState(
  request: Request,
  env: Env
): Promise<Response> {
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
        "Access-Control-Allow-Origin": "*",
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

  // Redirect to app with token
  return redirectToAppWithToken(tokenData);
}

/**
 * Redirect to app with successful token
 */
function redirectToAppWithToken(token: IntervalsTokenResponse): Response {
  const params = new URLSearchParams({
    success: "true",
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
    success: "false",
    error: error,
  });

  const redirectUrl = `${APP_SCHEME}://oauth/callback?${params.toString()}`;

  return Response.redirect(redirectUrl, 302);
}
