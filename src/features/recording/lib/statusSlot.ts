/**
 * Priority selection for the recording screen's single transient status
 * slot. At most one message shows at a time: a degraded GPS signal beats
 * a sensor issue, which beats a km-split toast.
 */

export interface StatusSlotInput {
  gpsWarning: string | null;
  sensorIssue: string | null;
  splitBanner: string | null;
}

export type StatusMessageKind = 'gps' | 'sensor' | 'split';

export interface StatusMessage {
  kind: StatusMessageKind;
  text: string;
}

export function selectStatusMessage({
  gpsWarning,
  sensorIssue,
  splitBanner,
}: StatusSlotInput): StatusMessage | null {
  if (gpsWarning) return { kind: 'gps', text: gpsWarning };
  if (sensorIssue) return { kind: 'sensor', text: sensorIssue };
  if (splitBanner) return { kind: 'split', text: splitBanner };
  return null;
}
