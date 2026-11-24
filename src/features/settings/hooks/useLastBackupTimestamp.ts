import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { getLastBackupTimestamp, isAutoBackupEnabled } from '@/features/settings/lib/autobackup';

/**
 * When the last backup ran, read once each time the screen appears. Undefined
 * until the first read, so a row cannot show `Never` for a backup it has not
 * yet looked for.
 *
 * The settings screen subscribes to eight preference stores, so it re-renders
 * on any of them, and the read underneath is an engine call holding the write
 * lock on the JavaScript thread. Focus is the right moment instead: a backup
 * is started from a screen this one pushes, so coming back is exactly when the
 * answer can have changed.
 */
export function useLastBackupTimestamp(): number | null | undefined {
  const [at, setAt] = useState<number | null | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      setAt(getLastBackupTimestamp());
    }, [])
  );

  return at;
}

/**
 * Whether automatic backup is on, read on focus beside the timestamp. Undefined
 * until the first read, so a row cannot show `Off` for a switch that is on.
 *
 * The switch lives on a screen this one pushes, so coming back is when it can
 * have changed.
 */
export function useAutoBackupEnabled(): boolean | undefined {
  const [enabled, setEnabled] = useState<boolean | undefined>(undefined);

  useFocusEffect(
    useCallback(() => {
      setEnabled(isAutoBackupEnabled());
    }, [])
  );

  return enabled;
}
