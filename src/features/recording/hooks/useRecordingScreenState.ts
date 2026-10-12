import { useCallback, useState } from 'react';

import type { SplitBanner } from '../lib/statusSlot';

interface GpsWarning {
  text: string;
  /** A refused permission, which only the settings page can clear. */
  opensSettings: boolean;
}

export type SetGpsWarning = (warning: string | null, options?: { opensSettings?: boolean }) => void;

export function useRecordingScreenState() {
  const [gpsWarning, setWarning] = useState<GpsWarning | null>(null);
  const [splitBanner, setSplitBanner] = useState<SplitBanner | null>(null);

  const setGpsWarning = useCallback<SetGpsWarning>((warning, options) => {
    setWarning(
      warning === null ? null : { text: warning, opensSettings: options?.opensSettings ?? false }
    );
  }, []);

  return {
    gpsWarning: gpsWarning?.text ?? null,
    gpsWarningOpensSettings: gpsWarning?.opensSettings ?? false,
    setGpsWarning,
    splitBanner,
    setSplitBanner,
  };
}
