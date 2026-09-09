import { useCallback, useEffect, useRef, useState } from 'react';

import type { RecordingStatus } from '../types';

/**
 * Lock state for the recording screen. The screen locks itself when a
 * recording starts so pocket and rain touches are ignored, and unlocking is
 * only possible via the slide track.
 *
 * Locking is deliberately tied to the start of a recording rather than to the
 * status being `recording`. Resuming sets the same status, so re-locking there
 * would throw the lock back on the moment the rider pressed resume, and with
 * auto-pause on it would do that at every traffic light while they were still
 * using the screen. An unlock the rider asked for survives until they lock it
 * again or start a new recording.
 */
export function useRecordingLock(status: RecordingStatus) {
  const [isLocked, setIsLocked] = useState(true);
  const previousStatus = useRef<RecordingStatus>(status);

  useEffect(() => {
    const startedRecording = previousStatus.current === 'stopped' && status === 'recording';
    previousStatus.current = status;
    if (startedRecording) setIsLocked(true);
  }, [status]);

  const lock = useCallback(() => setIsLocked(true), []);
  const unlock = useCallback(() => setIsLocked(false), []);

  return { isLocked, lock, unlock };
}
