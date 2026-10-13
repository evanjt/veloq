/**
 * The one verdict on a GPS fix. The entry screen, the live accuracy mark and the
 * recording's point filter all read it, so a fix the recording keeps is never
 * shown as bad and a fix it discards is never shown as ready.
 */
import type { SignalLevel } from '@/shared/ui';

/**
 * `discarded` is worse than the athlete's reject threshold and will not be
 * recorded; `coarse` is kept but loose; `none` carries no accuracy at all.
 */
export type GpsQuality = 'none' | 'good' | 'coarse' | 'discarded';

/** A fix tighter than this is good. Below every reject threshold the athlete can set. */
export const GPS_GOOD_ACCURACY_M = 5;

export function gpsQuality(
  accuracy: number | null | undefined,
  rejectThreshold: number
): GpsQuality {
  if (accuracy == null) return 'none';
  if (accuracy > rejectThreshold) return 'discarded';
  return accuracy < GPS_GOOD_ACCURACY_M ? 'good' : 'coarse';
}

/** Whether the recording keeps a fix. One with no accuracy is kept: nothing says it is loose. */
export function gpsFixKept(accuracy: number | null | undefined, rejectThreshold: number): boolean {
  return gpsQuality(accuracy, rejectThreshold) !== 'discarded';
}

const SIGNAL_LEVELS: Record<GpsQuality, SignalLevel> = {
  none: 'idle',
  good: 'ok',
  coarse: 'warn',
  discarded: 'bad',
};

export function gpsSignalLevel(quality: GpsQuality): SignalLevel {
  return SIGNAL_LEVELS[quality];
}
