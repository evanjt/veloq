import type { ActivityType, RecordingStatus } from '@/types';

/**
 * Where a way back into the session in the store leads. A stopped ride is still
 * a session: it is unsaved, and review is the only screen that can save or
 * discard it. A stopped ride the library already holds is saved, and there is
 * nothing to return to. Null when there is nothing to return to.
 */
export function sessionReturnRoute({
  status,
  activityType,
  savedToLibrary = false,
}: {
  status: RecordingStatus;
  activityType: ActivityType | null;
  savedToLibrary?: boolean;
}): string | null {
  if (status === 'stopped') return savedToLibrary ? null : '/recording/review';
  if ((status === 'recording' || status === 'paused') && activityType) {
    return `/recording/${activityType}`;
  }
  return null;
}
