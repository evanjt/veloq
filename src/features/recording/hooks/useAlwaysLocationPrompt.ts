import { useEffect } from 'react';
import * as Location from 'expo-location';

import { debug } from '@/shared/debug/debug';

import { useRecordingPreferences } from '../stores/RecordingPreferencesStore';
import type { RecordingStatus } from '../types';

const log = debug.create('AlwaysLocation');

/**
 * The Always location prompt, asked once and at the moment it earns itself: a
 * ride already running that was started from a quick-start surface, where the
 * athlete has just shown they want to start without the app in front.
 *
 * Not at launch and not on the picker. iOS shows the dialog once and a denial is
 * expensive to walk back, so an ask that has not been earned spends the only one
 * there is. Always is an upgrade on When In Use, so the foreground grant has to
 * be in hand first or the platform refuses the request outright.
 *
 * A refusal changes nothing: every ride started in the app keeps working on When
 * In Use, which is every ride today. The ask is recorded either way, so the
 * athlete is asked once and never nagged.
 */
export function useAlwaysLocationPrompt(fromQuickStart: boolean, status: RecordingStatus): void {
  const isLoaded = useRecordingPreferences((s) => s.isLoaded);
  const asked = useRecordingPreferences((s) => s.alwaysLocationAsked);
  const isRunning = status === 'recording' || status === 'paused';

  useEffect(() => {
    let cancelled = false;
    const earned = fromQuickStart && isLoaded && !asked && isRunning;

    void (async () => {
      if (!earned) return;
      let granted = false;
      try {
        granted = (await Location.getForegroundPermissionsAsync()).status === 'granted';
      } catch (e) {
        log.warn('Foreground status unavailable:', e);
      }
      // Always is an upgrade on When In Use. Without the grant the platform
      // refuses outright, and marking it asked would spend the one dialog on
      // nothing, so this is a wait rather than an ask.
      if (!cancelled && granted) {
        try {
          const { status } = await Location.requestBackgroundPermissionsAsync();
          log.log(`Always location ${status}`);
        } catch (e) {
          // A throw here is a refusal in another shape. Recording it as asked is
          // the point: the alternative is prompting again on the next start.
          log.warn('Always location request failed:', e);
        }
        if (!cancelled) useRecordingPreferences.getState().markAlwaysLocationAsked();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fromQuickStart, isLoaded, asked, isRunning]);
}
