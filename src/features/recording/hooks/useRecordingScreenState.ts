import { useState } from 'react';

export function useRecordingScreenState() {
  const [gpsWarning, setGpsWarning] = useState<string | null>(null);
  const [splitBanner, setSplitBanner] = useState<string | null>(null);

  return {
    gpsWarning,
    setGpsWarning,
    splitBanner,
    setSplitBanner,
  };
}
