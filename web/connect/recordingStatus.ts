// The upload states a recording can be in, as the phone's library names them,
// and the tone each one is drawn in. A state the page does not know reads as
// kept on the phone, which is what the phone itself shows for one.

import type { BadgeTone } from './ui';

export const UPLOAD_STATUSES = [
  'localOnly',
  'pending',
  'uploading',
  'uploaded',
  'failed',
  'permissionBlocked',
] as const;

export type UploadStatus = (typeof UPLOAD_STATUSES)[number];

/** The state a value names, or the one the phone shows for an unknown value. */
export function knownStatus(status: string): UploadStatus {
  return (UPLOAD_STATUSES as readonly string[]).includes(status)
    ? (status as UploadStatus)
    : 'localOnly';
}

/** The tone a state is drawn in; the text always carries the meaning too. */
export function uploadTone(status: UploadStatus): BadgeTone {
  switch (status) {
    case 'uploaded':
      return 'good';
    case 'failed':
      return 'bad';
    case 'permissionBlocked':
      return 'warning';
    default:
      return 'neutral';
  }
}
