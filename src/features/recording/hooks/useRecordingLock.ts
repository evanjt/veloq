import { useCallback, useEffect, useState } from 'react';

import type { RecordingStatus } from '../types';

/**
 * Lock state for the recording screen. The screen auto-locks whenever
 * recording is active so pocket/rain touches are ignored; unlocking is
 * only possible via the slide track.
 */
export function useRecordingLock(status: RecordingStatus) {
  const [isLocked, setIsLocked] = useState(true);

  useEffect(() => {
    if (status === 'recording') setIsLocked(true);
  }, [status]);

  const lock = useCallback(() => setIsLocked(true), []);
  const unlock = useCallback(() => setIsLocked(false), []);

  return { isLocked, lock, unlock };
}
