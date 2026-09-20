import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { getLastBackupTimestamp } from '@/features/settings/lib/autobackup';

/**
 * When the last backup ran, read once each time the screen appears.
 *
 * The settings screen subscribes to eight preference stores, so it re-renders
 * on any of them, and the read underneath is an engine call holding the write
 * lock on the JavaScript thread. Focus is the right moment instead: a backup
 * is started from a screen this one pushes, so coming back is exactly when the
 * answer can have changed.
 */
export function useLastBackupTimestamp(): number | null {
  const [at, setAt] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      setAt(getLastBackupTimestamp());
    }, [])
  );

  return at;
}
