# ADR-001: Dual Authentication Modes

## Status
Accepted

## Context
Veloq needs to support both privacy-conscious users who want local-only data storage and users who prefer the convenience of cloud features like push notifications. Additionally, intervals.icu API requires authentication (API key or OAuth), which creates a tension between privacy and functionality.

## Problem
- API-based authentication requires client secrets for OAuth flow, which shouldn't be embedded in mobile apps
- Some users want complete data privacy and local-only operation
- Push notifications require a backend to store push tokens
- Demo mode needs to work without any API credentials

## Decision
Support two distinct authentication modes that operate independently:

**Local Mode (API Key):**
- User provides API key from intervals.icu/settings
- Key stored in device SecureStore (encrypted)
- Direct API calls to intervals.icu from app
- No backend involvement
- No push notifications
- Data cached locally in SQLite via Rust engine

**Connected Mode (OAuth):**
- OAuth flow via Cloudflare Worker proxy
- Worker holds client secret, exchanges code for token
- Token returned to app, subsequent API calls still direct
- Backend stores push token for notifications
- Same local caching via Rust engine

## Consequences

### Positive
- **Privacy First**: Local mode aligns with open-source, privacy-first philosophy
- **User Choice**: Users can trade privacy for convenience (notifications)
- **Simplified Build**: No client secrets in mobile app
- **Fallback**: Demo mode works without any credentials

### Negative
- **Complex Auth Flow**: Two different auth paths to maintain
- **UX Confusion**: Users must understand difference between modes
- **Testing Overhead**: Must test both authentication paths
- **Documentation**: Need to clearly explain when to use each mode

### Mitigation
- Store mode preference in SecureStore
- Show mode indicator in UI
- Default to Local mode for new users
- Document trade-offs in onboarding guide

## Alternatives Considered

### Alternative 1: OAuth Only
**Pros**: Single auth path, push notifications for all
**Cons**: Requires backend for all users, conflicts with privacy-first philosophy

### Alternative 2: API Key Only
**Pros**: Simpler implementation, fully local
**Cons**: No push notifications possible, limits feature set

### Alternative 3: Embedded Client Secrets
**Pros**: Enables OAuth without backend
**Cons**: Security risk (secrets exposed in app binary), against OAuth best practices

## References
- OAuth 2.0 for Native Apps RFC: https://datatracker.ietf.org/doc/html/rfc6749#section-2.1
- intervals.icu API documentation
- Implementation: `src/providers/AuthProvider.tsx`
