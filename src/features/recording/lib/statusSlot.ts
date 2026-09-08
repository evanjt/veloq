/**
 * Priority selection for the recording screen's single transient status
 * slot. At most one message shows at a time: a refused foreground service beats
 * a degraded GPS signal, which beats a sensor issue, which beats a km-split
 * toast. The service comes first because a weak signal costs accuracy while a
 * refused service costs the whole ride the moment the screen goes.
 */

export interface StatusSlotInput {
  backgroundTrackingWarning: string | null;
  gpsWarning: string | null;
  sensorIssue: string | null;
  splitBanner: string | null;
}

export type StatusMessageKind = 'background' | 'gps' | 'sensor' | 'split';

export interface StatusMessage {
  kind: StatusMessageKind;
  text: string;
}

export function selectStatusMessage({
  backgroundTrackingWarning,
  gpsWarning,
  sensorIssue,
  splitBanner,
}: StatusSlotInput): StatusMessage | null {
  if (backgroundTrackingWarning) return { kind: 'background', text: backgroundTrackingWarning };
  if (gpsWarning) return { kind: 'gps', text: gpsWarning };
  if (sensorIssue) return { kind: 'sensor', text: sensorIssue };
  if (splitBanner) return { kind: 'split', text: splitBanner };
  return null;
}
