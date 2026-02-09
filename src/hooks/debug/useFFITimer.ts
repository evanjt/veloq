import { useRef, useCallback } from 'react';
import { getFFIMetricsCount, getFFIMetricsSince } from '@/lib/debug/renderTimer';

interface FFITimerEntry {
  name: string;
  durationMs: number;
  timestamp: number;
}

interface FFITimerResult {
  /** Get all FFI calls made since this hook mounted */
  getPageMetrics: () => FFITimerEntry[];
}

/**
 * Captures FFI metrics scoped to the current screen session.
 * On mount, snapshots the current metrics count. On read, returns
 * only entries recorded after the snapshot.
 */
export function useFFITimer(): FFITimerResult {
  const snapshotCount = useRef(getFFIMetricsCount());

  const getPageMetrics = useCallback(() => {
    return getFFIMetricsSince(snapshotCount.current);
  }, []);

  return { getPageMetrics };
}
