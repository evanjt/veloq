# Fast Background Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce GPS sync time from ~60-90s to ~12-14s with smooth per-activity progress updates.

**Architecture:** Remove TypeScript batching, add atomic progress counters in Rust (polled from TS every 100ms), reduce rate limit to 12 req/s for headroom.

**Tech Stack:** Rust (tracematch), TypeScript/React Native (veloq), UniFFI bindings

---

## Task 1: Update Rust Rate Limiter

**Files:**
- Modify: `tracematch/.worktrees/fast-background-sync/src/http.rs:21`

**Step 1: Change dispatch interval from 40ms to 83ms**

```rust
// OLD (line 21):
const DISPATCH_INTERVAL_MS: u64 = 40; // 1000ms / 25 = 40ms between dispatches

// NEW:
const DISPATCH_INTERVAL_MS: u64 = 83; // 1000ms / 12 = 83ms between dispatches (safe margin under 13.2/s limit)
```

**Step 2: Update the comment block**

```rust
// OLD (lines 18-20):
// Rate limits from intervals.icu API: 30/s burst, 132/10s sustained
// Target: 25 req/s (40ms intervals) - under 30 req/s burst limit
// With network latency (~200-400ms), actual sustained rate stays under 132/10s

// NEW:
// Rate limits from intervals.icu API: 30/s burst, 132/10s sustained (13.2/s average)
// Target: 12 req/s (83ms intervals) - conservative rate with 10% headroom
// This avoids 429 errors and is more respectful to the API
```

**Step 3: Verify build**

```bash
cd /home/evan/projects/personal/intervals/tracematch/.worktrees/fast-background-sync
cargo build
```

Expected: Build succeeds

**Step 4: Run tests**

```bash
cargo test
```

Expected: All tests pass

**Step 5: Commit**

```bash
git add src/http.rs
git commit -m "reduce rate limit from 25 req/s to 12 req/s for API headroom"
```

---

## Task 2: Add Atomic Progress Tracking to Rust

**Files:**
- Modify: `tracematch/.worktrees/fast-background-sync/src/http.rs`

**Step 1: Add global progress struct after imports (after line 16)**

```rust
use std::sync::atomic::AtomicBool;

/// Global progress state for FFI polling.
/// Uses atomics to allow safe concurrent access from fetch tasks and FFI polls.
pub struct DownloadProgress {
    completed: AtomicU32,
    total: AtomicU32,
    active: AtomicBool,
}

impl DownloadProgress {
    const fn new() -> Self {
        Self {
            completed: AtomicU32::new(0),
            total: AtomicU32::new(0),
            active: AtomicBool::new(false),
        }
    }
}

/// Global progress instance - single writer (fetch loop), multiple readers (FFI polls)
static DOWNLOAD_PROGRESS: DownloadProgress = DownloadProgress::new();

/// Reset progress counters at start of fetch operation
pub fn reset_download_progress(total: u32) {
    DOWNLOAD_PROGRESS.total.store(total, Ordering::Relaxed);
    DOWNLOAD_PROGRESS.completed.store(0, Ordering::Relaxed);
    DOWNLOAD_PROGRESS.active.store(true, Ordering::Relaxed);
}

/// Increment completed counter after each activity fetches
pub fn increment_download_progress() {
    DOWNLOAD_PROGRESS.completed.fetch_add(1, Ordering::Relaxed);
}

/// Mark download as complete
pub fn finish_download_progress() {
    DOWNLOAD_PROGRESS.active.store(false, Ordering::Relaxed);
}

/// Get current progress state (called by FFI)
pub fn get_download_progress() -> (u32, u32, bool) {
    (
        DOWNLOAD_PROGRESS.completed.load(Ordering::Relaxed),
        DOWNLOAD_PROGRESS.total.load(Ordering::Relaxed),
        DOWNLOAD_PROGRESS.active.load(Ordering::Relaxed),
    )
}
```

**Step 2: Update fetch_activity_maps to use atomic progress**

In `fetch_activity_maps` method (around line 162), add at the start:

```rust
pub async fn fetch_activity_maps(
    &self,
    activity_ids: Vec<String>,
    on_progress: Option<ProgressCallback>,
) -> Vec<ActivityMapResult> {
    use futures::stream::{self, StreamExt};

    let total = activity_ids.len() as u32;

    // Initialize global progress for FFI polling
    reset_download_progress(total);

    let completed = Arc::new(AtomicU32::new(0));
    // ... rest of existing code
```

**Step 3: Add increment after each activity completes**

Inside the async move block, after `let done = completed.fetch_add(1, ...)` (around line 199):

```rust
// Track progress
let done = completed.fetch_add(1, Ordering::Relaxed) + 1;

// Update global progress for FFI polling
increment_download_progress();

let bytes = result.latlngs.as_ref().map_or(0, |v| v.len() * 16) as u32;
// ... rest of existing code
```

**Step 4: Add finish at the end of fetch_activity_maps**

Before the final `results` return (around line 249):

```rust
info!(
    "[ActivityFetcher] DONE: {}/{} success ({} errors) in {:.2}s ({:.1} req/s, {}KB)",
    success_count, total, error_count, elapsed.as_secs_f64(), rate, total_kb
);

// Mark download complete for FFI polling
finish_download_progress();

results
```

**Step 5: Verify build**

```bash
cargo build
```

Expected: Build succeeds

**Step 6: Run tests**

```bash
cargo test
```

Expected: All tests pass

**Step 7: Commit**

```bash
git add src/http.rs
git commit -m "add atomic progress counters for FFI polling"
```

---

## Task 3: Export Progress Function via FFI

**Files:**
- Modify: `tracematch/.worktrees/fast-background-sync/src/ffi.rs`

**Step 1: Add FFI result struct (after FetchProgressCallback, around line 23)**

```rust
/// Result of polling download progress.
/// Used by TypeScript to show real-time progress without cross-thread callbacks.
#[derive(Debug, Clone, uniffi::Record)]
pub struct DownloadProgressResult {
    /// Number of activities fetched so far
    pub completed: u32,
    /// Total number of activities to fetch
    pub total: u32,
    /// Whether a download is currently active
    pub active: bool,
}
```

**Step 2: Add FFI export function (after fetch_activity_maps_with_progress, around line 280)**

```rust
/// Get current download progress for FFI polling.
///
/// TypeScript should poll this every 100ms during fetch operations
/// to get smooth progress updates without cross-thread callback issues.
///
/// Returns DownloadProgressResult with completed/total/active fields.
/// When active is false, the download has completed (or never started).
#[cfg(feature = "http")]
#[uniffi::export]
pub fn get_download_progress() -> DownloadProgressResult {
    let (completed, total, active) = crate::http::get_download_progress();
    DownloadProgressResult {
        completed,
        total,
        active,
    }
}
```

**Step 3: Verify build**

```bash
cargo build
```

Expected: Build succeeds

**Step 4: Run tests**

```bash
cargo test
```

Expected: All tests pass

**Step 5: Commit**

```bash
git add src/ffi.rs
git commit -m "export get_download_progress FFI function for polling"
```

---

## Task 4: Regenerate TypeScript Bindings

**Files:**
- Regenerate: `veloq/.worktrees/fast-background-sync/src/modules/route-matcher-native/src/generated/tracematch.ts`

**Step 1: Build Rust library for all targets**

```bash
cd /home/evan/projects/personal/intervals/veloq/.worktrees/fast-background-sync
npm run ubrn:build
```

Expected: Build completes for Android/iOS targets

**Step 2: Regenerate TypeScript bindings**

```bash
npm run ubrn:generate
```

Expected: New `tracematch.ts` generated with `getDownloadProgress` function and `DownloadProgressResult` type

**Step 3: Verify new function exists in generated code**

```bash
grep -n "getDownloadProgress\|DownloadProgressResult" src/modules/route-matcher-native/src/generated/tracematch.ts
```

Expected: Both function and type are present

**Step 4: Run TypeScript type check**

```bash
npm run typecheck
```

Expected: No type errors

**Step 5: Commit**

```bash
git add src/modules/route-matcher-native/src/generated/
git commit -m "regenerate bindings with get_download_progress"
```

---

## Task 5: Add TypeScript Wrapper for Download Progress

**Files:**
- Modify: `veloq/.worktrees/fast-background-sync/src/modules/route-matcher-native/src/index.ts`

**Step 1: Import the new function (add to imports around line 69)**

```typescript
import {
  // ... existing imports ...
  getDownloadProgress as ffiGetDownloadProgress,
  type DownloadProgressResult,
} from './generated/tracematch';
```

**Step 2: Re-export the type (around line 82)**

```typescript
export type { DownloadProgressResult };
```

**Step 3: Add wrapper function (after fetchActivityMapsWithProgress, around line 334)**

```typescript
/**
 * Get current download progress for polling.
 *
 * Call this every 100ms during fetch operations to get smooth progress updates.
 * Avoids cross-thread FFI callback issues by using atomic counters in Rust.
 *
 * @returns Progress with completed/total/active fields
 */
export function getDownloadProgress(): DownloadProgressResult {
  return ffiGetDownloadProgress();
}
```

**Step 4: Run TypeScript type check**

```bash
npm run typecheck
```

Expected: No type errors

**Step 5: Commit**

```bash
git add src/modules/route-matcher-native/src/index.ts
git commit -m "add getDownloadProgress wrapper function"
```

---

## Task 6: Remove Batching in useGpsDataFetcher

**Files:**
- Modify: `veloq/.worktrees/fast-background-sync/src/hooks/routes/useGpsDataFetcher.ts`

**Step 1: Add import for getDownloadProgress (around line 21)**

```typescript
import {
  routeEngine,
  detectSectionsMultiscale,
  gpsPointsToRoutePoints,
  SectionConfig,
  getDownloadProgress,  // ADD THIS
  type RouteGroup,
  type ActivitySportType,
} from 'route-matcher-native';
```

**Step 2: Replace the batch loop in fetchApiGps**

Find the batch loop (lines ~633-676) that looks like:

```typescript
// Batch activities to avoid blocking the JS thread for too long
const BATCH_SIZE = 10;
const allResults: Awaited<ReturnType<typeof nativeModule.fetchActivityMapsWithProgress>> = [];

for (let i = 0; i < activityIds.length; i += BATCH_SIZE) {
  // ... batch processing ...
}
```

Replace with:

```typescript
// Update initial progress
if (isMountedRef.current) {
  updateProgress({
    status: 'fetching',
    completed: 0,
    total: activityIds.length,
    message: `Downloading GPS data... 0/${activityIds.length}`,
  });
}

// Start fetch - sends all IDs to Rust in one call (Rust handles rate limiting)
const fetchPromise = nativeModule.fetchActivityMaps(authHeader, activityIds);

// Poll for progress while fetch runs (avoids cross-thread callback issues)
const pollInterval = setInterval(() => {
  if (!isMountedRef.current || abortSignal.aborted) {
    clearInterval(pollInterval);
    return;
  }

  const progress = getDownloadProgress();

  if (progress.active) {
    updateProgress({
      status: 'fetching',
      completed: progress.completed,
      total: progress.total,
      message: `Downloading GPS data... ${progress.completed}/${progress.total}`,
    });
  }
}, 100);

// Wait for completion
let results: Awaited<ReturnType<typeof nativeModule.fetchActivityMaps>>;
try {
  results = await fetchPromise;
} finally {
  clearInterval(pollInterval);
}

const allResults = results;
```

**Step 3: Run TypeScript type check**

```bash
npm run typecheck
```

Expected: No type errors

**Step 4: Run tests**

```bash
npm test
```

Expected: Tests pass (2 pre-existing failures in mapNullChildren.test.ts are OK)

**Step 5: Commit**

```bash
git add src/hooks/routes/useGpsDataFetcher.ts
git commit -m "remove batching, use single FFI call with progress polling"
```

---

## Task 7: Memoize Activity Bounds to Prevent Re-renders

**Files:**
- Modify: `veloq/.worktrees/fast-background-sync/src/hooks/activities/useActivityBoundsCache.ts`

**Step 1: Optimize the activities useMemo to prevent re-computation during sync**

Find the `activities` useMemo (around line 287) and update its dependencies:

```typescript
// Get activities with bounds from engine for map display
// IMPORTANT: Only recompute when activity count changes, NOT during sync progress updates
const activities = useMemo<ActivityBoundsItem[]>(() => {
  // If no GPS activities, return empty
  if (allGpsActivities.length === 0) {
    return [];
  }

  // Try to get bounds from engine
  const engine = getRouteEngine();
  if (!engine || activityCount === 0) {
    return [];
  }

  try {
    const engineBounds = engine.getAllActivityBounds();
    if (!engineBounds || engineBounds.size === 0) {
      return [];
    }

    // Create lookup map for activity metadata
    const activityMap = new Map<string, Activity>();
    for (const a of allGpsActivities) {
      activityMap.set(a.id, a);
    }

    // Merge engine bounds with cached metadata
    const result: ActivityBoundsItem[] = [];
    let debugCount = 0;

    for (const [id, b] of engineBounds.entries()) {
      const cached = activityMap.get(id);
      if (!cached) continue;

      if (__DEV__ && debugCount < 3) {
        console.log(
          `[useActivityBoundsCache] Raw engine bounds for ${id}: minLat=${b.minLat?.toFixed(4)}, minLng=${b.minLng?.toFixed(4)}, maxLat=${b.maxLat?.toFixed(4)}, maxLng=${b.maxLng?.toFixed(4)}`
        );
        debugCount++;
      }

      result.push({
        id,
        bounds: [
          [b.minLat, b.minLng],
          [b.maxLat, b.maxLng],
        ],
        type: (cached.type || 'Ride') as ActivityBoundsItem['type'],
        name: cached.name || '',
        date: cached.start_date_local || '',
        distance: cached.distance || 0,
        duration: cached.moving_time || 0,
      });
    }

    if (__DEV__) {
      console.log(
        `[useActivityBoundsCache] Built ${result.length} activities from engine bounds (${engineBounds.size} total in engine)`
      );
    }

    return result;
  } catch {
    return [];
  }
}, [activityCount, allGpsActivities]); // REMOVED: cachedActivitiesVersion
```

Note: Remove `cachedActivitiesVersion` from dependencies - it causes unnecessary recomputation.

**Step 2: Run TypeScript type check**

```bash
npm run typecheck
```

Expected: No type errors

**Step 3: Run tests**

```bash
npm test
```

Expected: Tests pass

**Step 4: Commit**

```bash
git add src/hooks/activities/useActivityBoundsCache.ts
git commit -m "optimize useMemo dependencies to prevent re-renders during sync"
```

---

## Task 8: Integration Test

**Files:**
- None (manual testing)

**Step 1: Start the app in development mode**

```bash
cd /home/evan/projects/personal/intervals/veloq/.worktrees/fast-background-sync
npm start
```

**Step 2: Clear cache and trigger full sync**

1. Open Settings
2. Clear cache
3. Navigate to Routes tab
4. Observe sync progress

**Expected behavior:**
- Progress updates smoothly (45/137, 46/137, 47/137...)
- No "stuck at 90%" behavior
- Total sync time for 137 activities: ~12-14 seconds
- UI remains responsive during sync

**Step 3: Check logs for rate limiting issues**

```bash
# In Metro terminal, look for:
# - No 429 errors
# - Dispatch rate ~12 req/s
# - getAllActivityBounds called only 1-2 times during sync
```

**Step 4: Verify with larger activity counts**

If you have access to an account with 200+ activities:
- Clear cache
- Sync and verify:
  - 200 activities at 12 req/s ≈ 17 seconds
  - Smooth progress throughout

---

## Summary

| Task | Files | Description |
|------|-------|-------------|
| 1 | `http.rs` | Reduce rate limit to 12 req/s |
| 2 | `http.rs` | Add atomic progress counters |
| 3 | `ffi.rs` | Export get_download_progress() |
| 4 | Generated | Regenerate TypeScript bindings |
| 5 | `index.ts` | Add TS wrapper function |
| 6 | `useGpsDataFetcher.ts` | Remove batching, add polling |
| 7 | `useActivityBoundsCache.ts` | Optimize useMemo dependencies |
| 8 | Manual | Integration test |

**Total estimated changes:**
- Rust: ~60 lines added/modified
- TypeScript: ~40 lines added/modified
- Commits: 7
