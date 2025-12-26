# Veloq

Mobile fitness tracking app bringing intervals.icu data to a polished mobile experience.

## Technical Stack

- **React Native + Expo** (SDK 54)
- **TanStack Query** - Server state, caching, offline
- **Zustand** - Local state (auth, preferences)
- **Victory Native + Skia** - Charts
- **MapLibre** - Maps
- **React Native Paper** - UI components

## Status

| WP | Feature | Status |
|----|---------|--------|
| WP0-7 | Core features | Done |
| WP8 | Route Matching | In Progress |

### Remaining Work

1. **OAuth** - Currently API key auth. Register with david@intervals.icu for OAuth.
2. **Workout Builder** - UI exists, server sync incomplete.
3. **iOS Optimization** - Platform-specific adjustments needed.
4. **Polish** - Search/filtering, notifications, widgets.

## intervals.icu API

```
Basic Auth: API_KEY:{your_api_key}
Rate limit: 30 req/s (use 3 concurrent for batch)

GET /api/v1/athlete/{id}/activities
GET /api/v1/activity/{id}
GET /api/v1/activity/{id}/streams.json
GET /api/v1/activity/{id}/map
GET /api/v1/athlete/{id}/wellness
GET /api/v1/athlete/{id}/power-curves.json
GET /api/v1/athlete/{id}/pace-curves.json
```

## Data Architecture

**Activity Feed**: Thin client, always fetch fresh (staleTime: 0).

**Map Bounds**: Must cache - API doesn't return polylines in list endpoint. N calls unavoidable for N GPS activities. `useActivityBoundsCache` handles this.

## Design System

| Element | Size | Weight |
|---------|------|--------|
| Screen Title | 28px | 600 |
| Card Title | 20px | 600 |
| Body | 16px | 400 |
| Stats | 18px | 700 |
| Labels | 14px | 400 |

**Colors**: Primary #D4AF37, Background #F5F5F5, Text #1A1A1A/#666666

**Spacing**: 8px base, 16px padding, 44px tap targets

## Git Guidelines

- One-line commits: `action: brief description`
- No GPG signing
- No attribution footers

## Banned Terms

| Banned | Use Instead |
|--------|-------------|
| segment | section, portion, range |

Exception: Library imports (e.g., `useSegments` from expo-router).
