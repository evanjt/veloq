/**
 * Debug utility to track component render timing and mount/unmount cycles.
 * Only logs in __DEV__ mode.
 *
 * Performance investigation utilities - enable PERF_DEBUG to see timing logs.
 */

import { AppState } from 'react-native';

// Toggle this to enable/disable performance logging
export const PERF_DEBUG = __DEV__;

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
 * Log screen render with render count tracking.
 * @example
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
 * Log Hermes JS heap stats for memory pressure investigation.
 * Usage: logMemory('FitnessScreen:mount');
 */
export function logMemory(label: string): void {
  if (!PERF_DEBUG) return;
  const stats = (global as any).HermesInternal?.getInstrumentedStats?.();
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

/**
 * Record an FFI call timing. Called by RouteEngineClient.timed() in dev mode.
 * Stores in a ring buffer (last 500 entries, zero allocation after warmup).
 */
export function recordFFIMetric(name: string, durationMs: number): void {
  const entry: FFIMetricEntry = { name, durationMs, timestamp: Date.now() };
  if (ffiMetricsCount < FFI_RING_BUFFER_SIZE) {
    ffiMetrics.push(entry);
  } else {
    ffiMetrics[ffiMetricsIndex] = entry;
  }
  ffiMetricsIndex = (ffiMetricsIndex + 1) % FFI_RING_BUFFER_SIZE;
  ffiMetricsCount++;
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
 * Get aggregated FFI metrics grouped by method name.
 * Returns per-method stats: call count, total/avg/max/p95 duration.
 */
export function getFFIMetricsSummary(): Record<string, FFIMethodSummary> {
  const entries = getFFIMetrics();
  const grouped: Record<string, number[]> = {};
  for (const entry of entries) {
    if (!grouped[entry.name]) grouped[entry.name] = [];
    grouped[entry.name].push(entry.durationMs);
  }
  const summary: Record<string, FFIMethodSummary> = {};
  for (const [name, durations] of Object.entries(grouped)) {
    durations.sort((a, b) => a - b);
    const total = durations.reduce((sum, d) => sum + d, 0);
    const p95Index = Math.floor(durations.length * 0.95);
    summary[name] = {
      calls: durations.length,
      totalMs: Math.round(total * 10) / 10,
      avgMs: Math.round((total / durations.length) * 10) / 10,
      maxMs: Math.round(durations[durations.length - 1] * 10) / 10,
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
}
