# Veloq OAuth Proxy

Cloudflare Worker that handles OAuth token exchange for intervals.icu.

## Why This Exists

intervals.icu OAuth requires a `client_secret` for token exchange. Embedding secrets in mobile apps is insecure (can be extracted). This worker keeps the secret server-side.

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/oauth/state` | POST | Register OAuth state for CSRF protection (app calls before OAuth flow) |
| `/oauth/callback` | GET | Receives OAuth code, validates state, exchanges for token, redirects to app |

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

**OAuth States (for CSRF protection):**
1. Go to **Workers & Pages** > **KV**
2. Click **Create a namespace**
3. Name it: `veloq-oauth-states`
4. Go back to your worker > **Settings** > **Bindings**
5. Click **Add** > **KV Namespace**
6. Variable name: `OAUTH_STATES`
7. Select your namespace
8. Click **Deploy** to apply

### 4. Add Secrets

1. Go to your worker > **Settings** > **Variables**
2. Under **Environment Variables**, click **Add variable**
3. Add these as **Encrypted** variables:

| Variable Name | Value |
|--------------|-------|
| `INTERVALS_CLIENT_ID` | Your OAuth client ID |
| `INTERVALS_CLIENT_SECRET` | Your OAuth client secret |

4. Click **Deploy** to apply

### 5. Custom Domain (Optional)

The worker is deployed at `https://auth.veloq.fit`.

## OAuth Flow

```
1. App generates state and registers it with proxy (CSRF protection):
   POST https://auth.veloq.fit/oauth/state
   Body: { "state": "random64chars..." }

2. App opens browser to:
   https://intervals.icu/oauth/authorize?
     client_id=YOUR_ID&
     redirect_uri=https://auth.veloq.fit/oauth/callback&
     scope=ACTIVITY:READ,WELLNESS:READ,CALENDAR:READ,SETTINGS:READ&
     state=random64chars...

3. User logs in and approves

4. intervals.icu redirects to worker with code and state:
   https://auth.veloq.fit/oauth/callback?code=xxx&state=random64chars...

5. Worker validates state against stored value (rejects if invalid/expired)

6. Worker exchanges code for token (with client_secret)

7. Worker redirects to app:
   veloq://oauth/callback?success=true&access_token=xxx&athlete_id=xxx&athlete_name=xxx

8. App stores token in Keychain
```

## Registration with intervals.icu

To register the OAuth application, provide:

- **App name**: Veloq
- **Redirect URI**: `https://auth.veloq.fit/oauth/callback`
- **Requested scopes**: ACTIVITY:READ, WELLNESS:READ, CALENDAR:READ, SETTINGS:READ

See the [intervals.icu API documentation](https://forum.intervals.icu/t/api-access-registering-your-own-app/781) for registration details.

## Mobile App Configuration

After deploying, update `src/lib/utils/constants.ts`:

```typescript
export const OAUTH = {
  CLIENT_ID: '<your client id>',
  PROXY_URL: 'https://veloq-oauth-proxy.<your-subdomain>.workers.dev',
  // ...
}
```

## Alternative: Deploy via Wrangler CLI

If you prefer the CLI:

```bash
npm install -g wrangler
wrangler login
wrangler deploy
wrangler secret put INTERVALS_CLIENT_ID
wrangler secret put INTERVALS_CLIENT_SECRET
```

## Testing

Test the health endpoint:
```bash
curl https://auth.veloq.fit/health
# Should return: OK
```

Test state registration:
```bash
curl -X POST https://auth.veloq.fit/oauth/state \
  -H "Content-Type: application/json" \
  -d '{"state":"test1234567890123456789012345678901234"}'
# Should return: {"success":true}
```

Test OAuth callback (will fail without valid state):
```bash
curl -I "https://auth.veloq.fit/oauth/callback?code=test&state=invalid"
# Should return 302 redirect to veloq://oauth/callback?success=false&error=invalid_state
```
