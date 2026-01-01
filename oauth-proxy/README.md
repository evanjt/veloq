# Veloq OAuth Proxy

Cloudflare Worker that handles OAuth token exchange and webhooks for intervals.icu.

## Why This Exists

intervals.icu OAuth requires a `client_secret` for token exchange. Embedding secrets in mobile apps is insecure (can be extracted). This worker keeps the secret server-side.

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/oauth/callback` | GET | Receives OAuth code, exchanges for token, redirects to app |
| `/webhooks/intervals` | POST | Receives webhooks from intervals.icu |
| `/webhooks/:athlete_id` | GET | App polls for pending webhook events |

## Deploy via Dashboard (No CLI Required)

### 1. Create Worker

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **Workers & Pages**
3. Click **Create** > **Create Worker**
4. Give it a name: `veloq-oauth-proxy`
5. Click **Deploy** (deploys the hello world template)

### 2. Add the Code

1. Click **Edit code**
2. Delete the default code
3. Copy and paste the contents of `src/worker.ts`
4. Click **Deploy**

### 3. Create KV Namespace

1. Go to **Workers & Pages** > **KV**
2. Click **Create a namespace**
3. Name it: `veloq-webhook-events`
4. Go back to your worker > **Settings** > **Bindings**
5. Click **Add** > **KV Namespace**
6. Variable name: `WEBHOOK_EVENTS`
7. Select your namespace
8. Click **Deploy** to apply

### 4. Add Secrets

1. Go to your worker > **Settings** > **Variables**
2. Under **Environment Variables**, click **Add variable**
3. Add these as **Encrypted** variables:

| Variable Name | Value |
|--------------|-------|
| `INTERVALS_CLIENT_ID` | Your client ID from David |
| `INTERVALS_CLIENT_SECRET` | Your client secret from David |
| `WEBHOOK_SECRET` | Your webhook secret from David |

4. Click **Deploy** to apply

### 5. Get Your Worker URL

Your worker is now live at:
```
https://veloq-oauth-proxy.<your-subdomain>.workers.dev
```

## OAuth Flow

```
1. App opens browser to:
   https://intervals.icu/oauth/authorize?
     client_id=YOUR_ID&
     redirect_uri=https://veloq-oauth-proxy.xxx.workers.dev/oauth/callback&
     scope=ACTIVITY:READ,WELLNESS:READ&
     state=random

2. User logs in and approves

3. intervals.icu redirects to worker:
   https://veloq-oauth-proxy.xxx.workers.dev/oauth/callback?code=xxx

4. Worker exchanges code for token (with client_secret)

5. Worker redirects to app:
   veloq://oauth/callback?success=true&access_token=xxx&athlete_id=xxx&athlete_name=xxx

6. App stores token in Keychain
```

## Webhook Flow

```
1. intervals.icu POSTs to:
   https://veloq-oauth-proxy.xxx.workers.dev/webhooks/intervals

2. Worker stores event in KV with 24h TTL

3. App polls:
   GET /webhooks/:athlete_id

4. Worker returns events and deletes them (one-time delivery)
```

## Registration with intervals.icu

Email david@intervals.icu with:

```
App name: Veloq
Description: Mobile fitness tracking app for intervals.icu
Website URL: https://veloq.fit
Logo image URL: [your logo, square, 128x128+]
Privacy policy URL: https://veloq.fit/privacy
Redirect URI: https://veloq-oauth-proxy.<your-subdomain>.workers.dev/oauth/callback
Webhook URL: https://veloq-oauth-proxy.<your-subdomain>.workers.dev/webhooks/intervals
Your intervals.icu ID: [from /settings page]
Requested scopes: ACTIVITY:READ, WELLNESS:READ, CALENDAR:READ, SETTINGS:READ
```

## Mobile App Configuration

After deploying, update your `.env` file:

```
EXPO_PUBLIC_INTERVALS_CLIENT_ID=<your client id from David>
EXPO_PUBLIC_OAUTH_PROXY_URL=https://veloq-oauth-proxy.<your-subdomain>.workers.dev
```

## Alternative: Deploy via Wrangler CLI

If you prefer the CLI:

```bash
npm install -g wrangler
wrangler login
wrangler deploy
wrangler secret put INTERVALS_CLIENT_ID
wrangler secret put INTERVALS_CLIENT_SECRET
wrangler secret put WEBHOOK_SECRET
```

## Testing

Test the health endpoint:
```bash
curl https://veloq-oauth-proxy.<your-subdomain>.workers.dev/health
# Should return: OK
```

Test OAuth callback (will redirect to app):
```bash
curl -I "https://veloq-oauth-proxy.<your-subdomain>.workers.dev/oauth/callback?code=test"
# Should return 302 redirect to veloq://oauth/callback?success=false&error=token_exchange_failed
```
