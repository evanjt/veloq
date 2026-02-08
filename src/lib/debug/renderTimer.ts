/**
 * Debug utility to track component render timing and mount/unmount cycles.
 * Only logs in __DEV__ mode.
 *
 * Performance investigation utilities - enable PERF_DEBUG to see timing logs.
 */

// Toggle this to enable/disable performance logging
export const PERF_DEBUG = __DEV__ && true;

const componentTimers: Map<string, number> = new Map();
const renderCounts: Map<string, number> = new Map();

export function logMount(componentName: string) {
  if (!__DEV__) return;
  const now = performance.now();
  componentTimers.set(componentName, now);
  console.log(`[MOUNT] ${componentName} @ ${now.toFixed(0)}ms`);
}

export function logUnmount(componentName: string) {
  if (!__DEV__) return;
  const mountTime = componentTimers.get(componentName);
  const now = performance.now();
  const lifespan = mountTime ? now - mountTime : 0;
  console.log(`[UNMOUNT] ${componentName} @ ${now.toFixed(0)}ms (lived ${lifespan.toFixed(0)}ms)`);
  componentTimers.delete(componentName);
}

export function logRender(componentName: string, reason?: string) {
  if (!__DEV__) return;
  const now = performance.now();
  console.log(`[RENDER] ${componentName} @ ${now.toFixed(0)}ms${reason ? ` - ${reason}` : ''}`);
}

export function logQueryStart(queryName: string) {
  if (!__DEV__) return;
  const now = performance.now();
  componentTimers.set(`query:${queryName}`, now);
  console.log(`[QUERY START] ${queryName} @ ${now.toFixed(0)}ms`);
}

export function logQueryEnd(queryName: string, status: 'success' | 'error' | 'settled') {
  if (!__DEV__) return;
  const startTime = componentTimers.get(`query:${queryName}`);
  const now = performance.now();
  const duration = startTime ? now - startTime : 0;
  console.log(
    `[QUERY ${status.toUpperCase()}] ${queryName} @ ${now.toFixed(0)}ms (took ${duration.toFixed(0)}ms)`
  );
}

/**
 * Hook to track component lifecycle in useEffect
 * Usage: useRenderDebug('MyComponent');
 */
export function useRenderDebug(componentName: string) {
  if (!__DEV__) return;

  // This runs on every render
  logRender(componentName);
}

// ============================================================================
// Performance Investigation Utilities
// ============================================================================

/**
 * Log FFI call timing. Use at start and end of FFI functions.
 * @example
 * const end = logFFIStart('getSections');
 * const result = persistentEngineGetSections();
 * end(); // Logs: [FFI] getSections: 45ms
 */
export function logFFIStart(ffiName: string): () => void {
  if (!PERF_DEBUG) return () => {};
  const start = performance.now();
  return () => {
    const duration = performance.now() - start;
    const color = duration > 100 ? '🔴' : duration > 50 ? '🟡' : '🟢';
    console.log(`${color} [FFI] ${ffiName}: ${duration.toFixed(1)}ms`);
  };
}

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
  renderCounts.set(screenName, count);
  return () => {
    const duration = performance.now() - start;
    const color = duration > 200 ? '🔴' : duration > 100 ? '🟡' : '🟢';
    console.log(`${color} [SCREEN] ${screenName} render #${count}: ${duration.toFixed(1)}ms`);
  };
}

/**
 * Log hook execution time.
 * @example
 * const endHook = logHookStart('useActivities');
 * // ... hook logic ...
 * endHook();
 */
export function logHookStart(hookName: string): () => void {
  if (!PERF_DEBUG) return () => {};
  const start = performance.now();
  return () => {
    const duration = performance.now() - start;
    if (duration > 10) {
      // Only log slow hooks
      const color = duration > 50 ? '🔴' : duration > 20 ? '🟡' : '⚪';
      console.log(`${color} [HOOK] ${hookName}: ${duration.toFixed(1)}ms`);
    }
  };
}

/**
 * Log navigation event.
 */
export function logNavigation(from: string, to: string) {
  if (!PERF_DEBUG) return;
  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`[NAV] ${from} → ${to}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
}

/**
 * Reset render counts and timers (call on app background/foreground)
 */
export function resetRenderCounts() {
  renderCounts.clear();
  componentTimers.clear();
}

/**
 * Get summary of render counts
 */
export function getRenderCountSummary(): Record<string, number> {
  if (!PERF_DEBUG) return {};
  return Object.fromEntries(renderCounts);
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
  // Ring buffer wrapped — return in chronological order
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
 * Clear all FFI metrics. Useful for isolating measurements.
 */
export function clearFFIMetrics(): void {
  ffiMetrics.length = 0;
  ffiMetricsIndex = 0;
  ffiMetricsCount = 0;
}
