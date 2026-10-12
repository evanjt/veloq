/**
 * Priority selection for the recording screen's single transient status
 * slot. At most one message shows at a time: a refused foreground service beats
 * a degraded GPS signal, which beats a sensor issue, which beats a km-split
 * toast. The service comes first because a weak signal costs accuracy while a
 * refused service costs the whole ride the moment the screen goes.
 */

/** A completed split: the line on screen, and the same in words for a screen reader. */
export interface SplitBanner {
  text: string;
  spoken: string;
}

export interface StatusSlotInput {
  backgroundTrackingWarning: string | null;
  gpsWarning: string | null;
  /** The GPS warning is a refused permission, which only the settings page can clear. */
  gpsWarningOpensSettings?: boolean | undefined;
  sensorIssue: string | null;
  splitBanner: SplitBanner | null;
}

export type StatusMessageKind = 'background' | 'gps' | 'sensor' | 'split';

export interface StatusMessage {
  kind: StatusMessageKind;
  text: string;
  opensSettings?: true;
  /** What a screen reader says, which is `text` unless the screen abbreviates. */
  spoken: string;
}

export function selectStatusMessage({
  backgroundTrackingWarning,
  gpsWarning,
  gpsWarningOpensSettings,
  sensorIssue,
  splitBanner,
}: StatusSlotInput): StatusMessage | null {
  if (backgroundTrackingWarning)
    return {
      kind: 'background',
      text: backgroundTrackingWarning,
      spoken: backgroundTrackingWarning,
    };
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
