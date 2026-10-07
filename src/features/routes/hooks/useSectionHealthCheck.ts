/**
 * One-shot self-heal for users who upgraded across the corridor-detection
 * regression. If the local SQLite has activities but no sections (either
 * because an earlier build saved sections with empty activity_portions and
 * stale debug names, or because detection never ran), force a fresh full
 * redetect so the user sees real section data without manually digging into
 * the detection settings.
 *
 * Runs at most once per library (stamped in the engine's settings, so a wipe
 * or a restore leaves the next library owed the check). Designed to be
 * cheap when there is nothing to do.
 */

import { useEffect, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { hasStarted } from 'veloqrs';
import { getEngine } from '@/shared/native/engine';
import { isRouteMatchingEnabled } from '@/features/routes/stores/RouteSettingsStore';

/** Whether this library has spent its one-shot redetect. Engine-owned: a clear removes it. */
export const SECTION_HEALTH_CHECK_SETTING = '__section_health_check_done';

/** Where builds before the engine stamp kept it, read once and removed. */
export const LEGACY_SECTION_HEALTH_CHECK_KEY = 'veloq-section-health-check-v1';

export function useSectionHealthCheck(syncComplete: boolean): void {
  const ranRef = useRef(false);

  useEffect(() => {
    if (!syncComplete || ranRef.current) return;
    if (!isRouteMatchingEnabled()) return;

    ranRef.current = true;

    (async () => {
      try {
        const engine = getEngine();
        if (!engine) return;

        const legacy = await AsyncStorage.getItem(LEGACY_SECTION_HEALTH_CHECK_KEY);
        if (legacy !== null) {
          if (legacy === 'done') engine.setSetting(SECTION_HEALTH_CHECK_SETTING, '1');
          await AsyncStorage.removeItem(LEGACY_SECTION_HEALTH_CHECK_KEY);
        }
        if (engine.getSetting(SECTION_HEALTH_CHECK_SETTING)) return;

        const activityCount = engine.getActivityCount?.() ?? 0;
        if (activityCount === 0) return;

        const sectionCount = engine.getSectionCount?.() ?? 0;
        if (sectionCount > 0) {
          engine.setSetting(SECTION_HEALTH_CHECK_SETTING, '1');
          return;
        }

        // A cutover suspends detection and re-cuts the whole catalogue
        // itself, so a redetect here is refused and the empty catalogue is
        // expected. Stamping through it would spend the one-shot on nothing.
        if (engine.isCutoverPending?.() || engine.isCutoverRunning?.()) return;

        // Stamp only on a redetect the engine actually accepted. A refusal
        // means detection is suspended, and the check is owed a later launch.
        if (hasStarted(engine.forceRedetectSections())) {
          engine.setSetting(SECTION_HEALTH_CHECK_SETTING, '1');
        }
      } catch {
        // best-effort
      }
    })();
  }, [syncComplete]);
}
