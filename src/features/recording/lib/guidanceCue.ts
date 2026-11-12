import { FfiFollowStatus, type FfiRouteFollow } from 'veloqrs';

import { i18n } from '@/i18n';
import { getIsMetric } from '@/shared/app/UnitPreferenceStore';
import { formatDistance } from '@/shared/format/format';

export interface GuidanceCueResult {
  /** The line the ride's off-screen surfaces show, or null when they show none. */
  line: string | null;
  /** True once, on the record that moves the ride off the route. */
  vibrate: boolean;
  /** Whether the line differs from the one before this record. */
  changed: boolean;
}

/**
 * Turns the stream of followed-route records into the cues the screen-off surfaces need: a
 * line while the ride is off its route, and one vibration request when it leaves. The line is
 * written when the state changes and held for as long as the state lasts, so a notification
 * is not re-posted for every fix that only moves the distance. A ride that has not joined the
 * route, or has no record, has no cue.
 */
export function createGuidanceCue(describeOffRoute: (guidance: FfiRouteFollow) => string) {
  let line: string | null = null;
  let pendingVibration = false;

  return {
    observe(guidance: FfiRouteFollow | null): GuidanceCueResult {
      const off = guidance?.status === FfiFollowStatus.OffRoute;
      if (guidance && off) {
        if (line !== null) return { line, vibrate: false, changed: false };
        line = describeOffRoute(guidance);
        pendingVibration = true;
        return { line, vibrate: true, changed: true };
      }
      if (line === null) return { line: null, vibrate: false, changed: false };
      line = null;
      return { line: null, vibrate: false, changed: true };
    },
    /** The line now showing, or null. */
    get line(): string | null {
      return line;
    },
    /** Whether a departure's vibration has not been handed to a surface yet; reading it clears it. */
    takeVibration(): boolean {
      const pending = pendingVibration;
      pendingVibration = false;
      return pending;
    },
    reset(): void {
      line = null;
      pendingVibration = false;
    },
  };
}

function describeOffRoute(guidance: FfiRouteFollow): string {
  const t = i18n.t as unknown as (key: string, options: Record<string, string>) => string;
  return t('recording.guidance.offRoute', {
    distance: formatDistance(guidance.crossTrackM, getIsMetric()),
  });
}

/** The one cue the ride's session keeps, read by the notification and the Live Activity. */
export const sessionGuidanceCue = createGuidanceCue(describeOffRoute);
