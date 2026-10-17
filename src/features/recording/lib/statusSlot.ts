/**
 * Priority selection for the recording screen's single transient status
 * slot. At most one message shows at a time. A lap press comes first, because
 * it answers the athlete's own press and lasts seconds, and every standing
 * warning returns once it has gone. Then a refused foreground service beats
 * a failing crash backup, which beats a degraded GPS signal, which beats a
 * sensor issue, which beats a km-split toast. The service comes first because
 * it costs the whole ride the moment the screen goes. A failing backup costs it
 * only on a crash, but everything since the last good write, where a weak
 * signal costs accuracy.
 */

/** A completed split: the line on screen, and the same in words for a screen reader. */
export interface SplitBanner {
  text: string;
  spoken: string;
}

export interface StatusSlotInput {
  backgroundTrackingWarning: string | null;
  /** The crash backup has stopped landing, so a kill would lose the ride since. */
  backupWarning?: string | null | undefined;
  gpsWarning: string | null;
  /** The GPS warning is a refused permission, which only the settings page can clear. */
  gpsWarningOpensSettings?: boolean | undefined;
  sensorIssue: string | null;
  splitBanner: SplitBanner | null;
  /** The lap just pressed, its number and time, for a few seconds. */
  lapBanner?: string | null | undefined;
}

export type StatusMessageKind = 'background' | 'backup' | 'gps' | 'sensor' | 'split' | 'lap';

export interface StatusMessage {
  kind: StatusMessageKind;
  text: string;
  opensSettings?: true;
  /** What a screen reader says, which is `text` unless the screen abbreviates. */
  spoken: string;
}

export function selectStatusMessage({
  backgroundTrackingWarning,
  backupWarning,
  gpsWarning,
  gpsWarningOpensSettings,
  sensorIssue,
  splitBanner,
  lapBanner,
}: StatusSlotInput): StatusMessage | null {
  if (lapBanner) return { kind: 'lap', text: lapBanner, spoken: lapBanner };
  if (backgroundTrackingWarning)
    return {
      kind: 'background',
      text: backgroundTrackingWarning,
      spoken: backgroundTrackingWarning,
    };
  if (backupWarning) return { kind: 'backup', text: backupWarning, spoken: backupWarning };
  if (gpsWarning) {
    return gpsWarningOpensSettings
      ? { kind: 'gps', text: gpsWarning, spoken: gpsWarning, opensSettings: true }
      : { kind: 'gps', text: gpsWarning, spoken: gpsWarning };
  }
  if (sensorIssue) return { kind: 'sensor', text: sensorIssue, spoken: sensorIssue };
  if (splitBanner?.text)
    return { kind: 'split', text: splitBanner.text, spoken: splitBanner.spoken };
  return null;
}
