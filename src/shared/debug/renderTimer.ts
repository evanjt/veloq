/**
 * Debug utility to track component render timing and mount/unmount cycles.
 * Only logs in __DEV__ mode.
 *
 * Performance investigation utilities - enable PERF_DEBUG to see timing logs.
 */

import Constants from 'expo-constants';
import { AppState } from 'react-native';

import { hermesStats } from './hermesStats';

// Toggle this to enable/disable performance logging
export const PERF_DEBUG = __DEV__;

/**
 * Whether this build is the dev variant, which `app.config.js` records in `extra.variant`. An
 * installable debug APK is bundled with `__DEV__` false, so the build variant is the gate a
 * handset run can rely on; a production build carries `production`.
 */
export const COMMIT_MARK_ENABLED = __DEV__ || Constants.expoConfig?.extra?.variant === 'dev';

const renderCounts: Map<string, number> = new Map();

// Clear debug Maps when app goes to background to prevent unbounded growth
if (__DEV__) {
  AppState.addEventListener('change', (state) => {
    if (state === 'background') {
      renderCounts.clear();
    }
  });
}

// ============================================================================
// Performance Investigation Utilities
// ============================================================================

/**
 * Log screen render with render count tracking, used as:
 * // At top of component function:
 * const perfEnd = logScreenRender('FeedScreen');
 * // At end or in useEffect:
 * perfEnd();
 */
export function logScreenRender(screenName: string): () => void {
  if (!PERF_DEBUG) return () => {};
  const start = performance.now();
  const count = (renderCounts.get(screenName) ?? 0) + 1;
  if (renderCounts.size > 200) renderCounts.clear();
  renderCounts.set(screenName, count);
  return () => {
    const duration = performance.now() - start;
    const color = duration > 200 ? '🔴' : duration > 100 ? '🟡' : '🟢';
    console.log(`${color} [SCREEN] ${screenName} render #${count}: ${duration.toFixed(1)}ms`);
  };
}

/**
 * Stamp a commit with a performance mark and log it as one `[COMMIT]` line. A handset run
 * greps logcat for the line beside the frame capture's timestamps. Dev-variant builds only.
 * The line goes out through `console.error` because the release Babel config strips every other
 * console method from an embedded bundle.
 */
export function logCommitMark(name: string, detail: string): void {
  if (!COMMIT_MARK_ENABLED) return;
  performance.mark(name);
  console.error(`⏱ [COMMIT] ${name} ${detail} at ${performance.now().toFixed(1)}ms`);
}

/**
 * Log Hermes JS heap stats for memory pressure investigation.
 * Usage: logMemory('FitnessScreen:mount');
 */
export function logMemory(label: string): void {
  if (!PERF_DEBUG) return;
  const stats = hermesStats();
  if (!stats) return;
  const heapMB = (stats['js_heapSize'] / 1024 / 1024).toFixed(1);
  const allocMB = (stats['js_totalAllocatedBytes'] / 1024 / 1024).toFixed(1);
  const gcCount = stats['js_numGCs'];
  console.log(`🧠 [MEM] ${label}: heap=${heapMB}MB alloc=${allocMB}MB GCs=${gcCount}`);
}

// ============================================================================
// FFI Metrics Accumulator
// ============================================================================

interface FFIMetricEntry {
  name: string;
  durationMs: number;
  timestamp: number;
}

const FFI_RING_BUFFER_SIZE = 500;
const ffiMetrics: FFIMetricEntry[] = [];
let ffiMetricsIndex = 0;
let ffiMetricsCount = 0;

// Per-name totals outlive the ring: a burst of one call name would otherwise push the rest out
// of the summary, and a ride's calls read as missing. Durations for p95 stay bounded per name.
interface FFINameStats {
  calls: number;
  totalMs: number;
  maxMs: number;
  recent: number[];
  next: number;
}
const ffiNameStats = new Map<string, FFINameStats>();

function accumulate(name: string, durationMs: number): void {
  let stats = ffiNameStats.get(name);
  if (!stats) {
    stats = { calls: 0, totalMs: 0, maxMs: 0, recent: [], next: 0 };
    ffiNameStats.set(name, stats);
  }
  stats.calls++;
  stats.totalMs += durationMs;
  if (durationMs > stats.maxMs) stats.maxMs = durationMs;
  if (stats.recent.length < FFI_RING_BUFFER_SIZE) {
    stats.recent.push(durationMs);
  } else {
    stats.recent[stats.next] = durationMs;
  }
  stats.next = (stats.next + 1) % FFI_RING_BUFFER_SIZE;
}

/**
 * Record an FFI call timing. Called by EngineClient.timed() while debug is on.
 * Stores in a ring buffer (last 500 entries, zero allocation after warmup).
 */
export function recordFFIMetric(name: string, durationMs: number): void {
  accumulate(name, durationMs);
  const entry: FFIMetricEntry = { name, durationMs, timestamp: Date.now() };
  if (ffiMetricsCount < FFI_RING_BUFFER_SIZE) {
    ffiMetrics.push(entry);
  } else {
    ffiMetrics[ffiMetricsIndex] = entry;
  }
  ffiMetricsIndex = (ffiMetricsIndex + 1) % FFI_RING_BUFFER_SIZE;
  ffiMetricsCount++;
}

let appMetricsEnabled = false;

/** Follows the Debug Mode switch; set by the debug store. */
export function setAppMetricsEnabled(enabled: boolean): void {
  appMetricsEnabled = enabled;
}

/**
 * Record a timing taken in app code. A no-op while Debug Mode is off, so the
 * ring holds the same window for app rows and engine rows.
 */
export function recordAppMetric(name: string, durationMs: number): void {
  if (!appMetricsEnabled) return;
  recordFFIMetric(name, durationMs);
}

/**
 * Run `work` and record how long it took under `name`, for the decoding a
 * screen does after an engine call returns, which the engine row does not
 * include. Runs `work` alone while Debug Mode is off. A throw is timed too.
 */
export function timeAppWork<T>(name: string, work: () => T): T {
  if (!appMetricsEnabled) return work();
  const startedAt = performance.now();
  try {
    return work();
  } finally {
    recordFFIMetric(name, performance.now() - startedAt);
  }
}

/**
 * Get raw FFI metrics (last 500 calls, oldest first).
 */
export function getFFIMetrics(): FFIMetricEntry[] {
  if (ffiMetricsCount <= FFI_RING_BUFFER_SIZE) {
    return [...ffiMetrics];
  }
  // Ring buffer wrapped - return in chronological order
  return [...ffiMetrics.slice(ffiMetricsIndex), ...ffiMetrics.slice(0, ffiMetricsIndex)];
}

interface FFIMethodSummary {
  calls: number;
  totalMs: number;
  avgMs: number;
  maxMs: number;
  p95Ms: number;
}

/**
 * Get aggregated FFI metrics grouped by method name, over every call since the last clear.
 * Returns per-method stats: call count, total/avg/max duration, and p95 over the latest 500 calls of that name.
 */
export function getFFIMetricsSummary(): Record<string, FFIMethodSummary> {
  const summary: Record<string, FFIMethodSummary> = {};
  for (const [name, stats] of ffiNameStats) {
    const durations = [...stats.recent].sort((a, b) => a - b);
    const p95Index = Math.floor(durations.length * 0.95);
    summary[name] = {
      calls: stats.calls,
      totalMs: Math.round(stats.totalMs * 10) / 10,
      avgMs: Math.round((stats.totalMs / stats.calls) * 10) / 10,
      maxMs: Math.round(stats.maxMs * 10) / 10,
      p95Ms: Math.round(durations[p95Index] * 10) / 10,
    };
  }
  return summary;
}

/**
 * Get the total number of FFI metrics recorded (monotonically increasing).
 * Used by useFFITimer to snapshot the count on mount and diff on read.
 */
export function getFFIMetricsCount(): number {
  return ffiMetricsCount;
}

/**
 * Get FFI metrics recorded since a given count snapshot.
 * Returns only entries added after the snapshot.
 */
export function getFFIMetricsSince(sinceCount: number): FFIMetricEntry[] {
  const added = ffiMetricsCount - sinceCount;
  if (added <= 0) return [];
  const all = getFFIMetrics();
  return all.slice(Math.max(0, all.length - added));
}

/**
 * Clear all FFI metrics. Useful for isolating measurements.
 */
export function clearFFIMetrics(): void {
  ffiMetrics.length = 0;
  ffiMetricsIndex = 0;
  ffiMetricsCount = 0;
  ffiNameStats.clear();
}
