import { useCallback, useState } from 'react';
import { getEngine } from '@/shared/native/engine';

/**
 * A route's exclusion writes and whether its excluded attempts are shown.
 *
 * The excluded attempts themselves come from the route performance read, for
 * the sport and range on screen. `onRouteRefresh` is called after each write
 * so the caller re-reads it: the excluded list and the ranked attempts then
 * come from one read, and the hook holds no copy of the set to move ahead of
 * it.
 */
export function useExcludedActivities(id: string | undefined, onRouteRefresh?: () => void) {
  const [showExcluded, setShowExcluded] = useState(false);

  const handleExcludeActivity = useCallback(
    (activityId: string) => {
      if (!id) return;
      const engine = getEngine();
      if (!engine) return;
      engine.excludeActivityFromRoute(id, activityId);
      onRouteRefresh?.();
    },
    [id, onRouteRefresh]
  );

  const handleIncludeActivity = useCallback(
    (activityId: string) => {
      if (!id) return;
      const engine = getEngine();
      if (!engine) return;
      engine.includeActivityInRoute(id, activityId);
      onRouteRefresh?.();
    },
    [id, onRouteRefresh]
  );

  const handleToggleShowExcluded = useCallback(() => {
    setShowExcluded((v) => !v);
  }, []);

  return {
    showExcluded,
    handleExcludeActivity,
    handleIncludeActivity,
    handleToggleShowExcluded,
  };
}
