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
import { getEngine } from '@/shared/native/engine';
import { isRouteMatchingEnabled } from '@/features/routes/stores/RouteSettingsStore';

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

        const engine = getEngine();
        if (!engine) return;

        const activityCount = engine.getActivityCount?.() ?? 0;
        if (activityCount === 0) return;

        const sectionCount = engine.getSectionCount?.() ?? 0;
        if (sectionCount > 0) {
          await AsyncStorage.setItem(FLAG_KEY, 'done');
          return;
        }

        // A cutover suspends detection and re-cuts the whole catalogue
        // itself, so a redetect here is refused and the empty catalogue is
        // expected. Stamping through it would spend the one-shot on nothing.
        if (engine.isCutoverPending?.() || engine.isCutoverRunning?.()) return;

        // Stamp only on a redetect the engine actually accepted. A refusal
        // means detection is suspended, and the check is owed a later launch.
        if (engine.forceRedetectSections()) {
          await AsyncStorage.setItem(FLAG_KEY, 'done');
        }
      } catch {
        // best-effort
      }
    })();
  }, [syncComplete]);
}
