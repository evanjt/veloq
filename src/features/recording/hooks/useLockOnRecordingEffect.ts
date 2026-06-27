import { useEffect } from 'react';

import type { RecordingStatus } from '../types';

// Re-lock when recording resumes
export function useLockOnRecordingEffect(
  status: RecordingStatus,
  setIsLocked: (locked: boolean) => void
) {
  useEffect(() => {
    if (status === 'recording') setIsLocked(true);
  }, [status, setIsLocked]);
}
