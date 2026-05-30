/**
 * One-shot self-heal for users who upgraded across the corridor-detection
 * regression. If the local SQLite has activities but no sections (either
 * because an earlier build saved sections with empty activity_portions and
 * stale debug names, or because detection never ran), force a fresh full
 * redetect so the user sees real section data without manually digging into
 * the detection settings.
 *
 * Runs at most once per install (flagged in AsyncStorage). Designed to be
 * cheap when there is nothing to do.
 */

import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { isRouteMatchingEnabled } from '@/providers/RouteSettingsStore';

const FLAG_KEY = 'veloq-section-health-check-v1';

export function useSectionHealthCheck(syncComplete: boolean): void {
  const ranRef = useRef(false);

  useEffect(() => {
    if (!syncComplete || ranRef.current) return;
    if (!isRouteMatchingEnabled()) return;

    ranRef.current = true;

    (async () => {
      try {
        const alreadyRan = await AsyncStorage.getItem(FLAG_KEY);
        if (alreadyRan === 'done') return;

        const engine = getRouteEngine();
        if (!engine) return;

        const activityCount = engine.getActivityCount?.() ?? 0;
        if (activityCount === 0) return;

        const sectionCount = engine.getSectionCount?.() ?? 0;
        if (sectionCount > 0) {
          await AsyncStorage.setItem(FLAG_KEY, 'done');
          return;
        }

        await AsyncStorage.setItem(FLAG_KEY, 'done');
        engine.forceRedetectSections(undefined);
      } catch {
        // best-effort
      }
    })();
  }, [syncComplete]);
}
