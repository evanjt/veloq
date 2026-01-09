# ADR-003: TanStack Query with Zero staleTime

## Status
Accepted

## Context
Veloq fetches activity data from intervals.icu API and displays it in multiple places:
- Activity feed (list view)
- Activity detail page
- Stats calculations
- Charts and graphs

TanStack Query (React Query) provides caching, background refetching, and stale-while-revalidate UI. However, the standard approach conflicts with a use case: users expect their activity feed to always be fresh.

## Problem
**Standard Caching Approach:**
```typescript
useQuery(['activities'], fetchActivities, {
  staleTime: 5 * 60 * 1000, // 5 minutes
  gcTime: 10 * 60 * 1000,    // 10 minutes
});
```

**Issues with intervals.icu:**
1. **Activities are time-critical**: Users upload activities and expect to see them immediately
2. **Frequent updates**: Users may sync multiple activities in quick succession
3. **Manual refresh**: Users pull-to-refresh expecting fresh data
4. **Stale perception**: "Why is my new run not showing up?"

**Inefficiency:**
- Cache is invalidated almost immediately on every app open
- Background refetch wastes API quota
- Complexity of cache invalidation for minimal benefit

## Decision
Set `staleTime: 0` for the activity list query, disabling caching for the list endpoint. Enable caching for detail endpoints (streams, zones) that are expensive to fetch and don't change.

**Implementation:**
```typescript
// Activity feed - always fresh
const { data: activities } = useQuery({
  queryKey: ['activities'],
  queryFn: fetchActivities,
  staleTime: 0, // Never consider data fresh
});

// Activity details - cached
const { data: streams } = useQuery({
  queryKey: ['activityStreams', id],
  queryFn: () => fetchActivityStreams(id),
  staleTime: 10 * 60 * 1000, // 10 minutes
});
```

**Route Engine Integration:**
- Activity IDs added to Rust engine immediately on fetch
- Route groups/sections computed lazily in Rust (cached in SQLite)
- No need to re-fetch GPS tracks for already-cached routes

## Consequences

### Positive
- **Always Fresh**: Activity feed shows current data, no confusion
- **Simple Invalidation**: No complex cache key management
- **Reduced Network**: Detail endpoint caching still saves bandwidth
- **Better UX**: Pull-to-refresh always fetches fresh data (expected behavior)
- **API Efficiency**: Don't refetch lists that will change anyway

### Negative
- **More API Calls**: Every app open fetches full activity list
- **No Offline Support**: Can't browse activity list offline
- **Rate Limit Risk**: More frequent API calls could hit limits

### Mitigation
- intervals.icu rate limit is 30 req/s (very generous)
- Activity list is lightweight (IDs + metadata, no GPS)
- Rust engine caches GPS tracks in SQLite for offline viewing
- Future: Consider hybrid approach (staleTime: 30s for balance)

## Trade-offs

### Why Not Infinite staleTime?
```typescript
staleTime: Infinity
```
**Pros**: Never fetches automatically, zero wasted calls
**Cons**: User uploads activity on phone A, won't see on phone B without manual refresh

### Why Not Longer staleTime?
```typescript
staleTime: 60 * 1000 // 1 minute
```
**Pros**: Reduces API calls by ~50%
**Cons**: User sees stale data for 1 minute, creates perception of "broken app"

### Zero staleTime Choice
Intervals.icu is designed for real-time sync. Users expect to see activities immediately after upload. The 30 req/s limit means we can afford to fetch often.

## Alternatives Considered

### Alternative 1: Standard Caching (5 min staleTime)
**Pros**: Reduces API calls by 90%
**Cons**: Confusing UX, users think app is broken

### Alternative 2: Aggressive Caching + Background Refetch
**Pros**: Fresh UI, reduced calls
**Cons**: Complex background refetch logic, battery drain

### Alternative 3: Hybrid (staleTime: 30s + refetchOnMount)
**Pros**: Balances freshness and efficiency
**Cons**: Adds complexity, still shows stale data sometimes

## Data Flow

```
App Open → useQuery(['activities'], staleTime: 0)
         ↓
         Always fetch from API
         ↓
         Add new IDs to Rust engine (GPS fetched separately)
         ↓
         Routes computed lazily on navigation to Routes screen
```

## References
- TanStack Query docs: https://tanstack.com/query/latest/docs/react/overview
- intervals.icu API documentation
- Implementation: `src/hooks/activities/useActivities.ts`
