import { useMemo } from 'react';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { useEngineSubscription } from '@/hooks/routes/useRouteEngine';
import type { ActivityPattern } from '@/types';

/**
 * Fetch activity patterns from the Rust engine's k-means clustering.
 * Patterns are computed from all activities in SQLite, grouped by sport type.
 *
 * Only surfaces patterns meeting confidence >= 0.6 threshold.
 * (Unobtrusiveness is the strongest predictor of continued app use —
 * JMIR mHealth 2022, PSD in Mobile Health)
 *
 * Subscribes to engine activity events so patterns refresh after sync.
 */
export function useActivityPatterns(): {
  todayPattern: ActivityPattern | null;
  allPatterns: ActivityPattern[];
} {
  const trigger = useEngineSubscription(['activities', 'sections']);

  const result = useMemo(() => {
    const engine = getRouteEngine();
    if (!engine) return { todayPattern: null, allPatterns: [] };

    try {
      const bundle = engine.getActivityPatternsWithToday();
      return { todayPattern: bundle.today ?? null, allPatterns: bundle.all };
    } catch {
      return { todayPattern: null, allPatterns: [] };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  return result;
}
