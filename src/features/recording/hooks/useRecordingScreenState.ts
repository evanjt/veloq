import { useState } from 'react';

import type { HrZoneInfo } from '../components/DataFieldGrid';

export function useRecordingScreenState() {
  const [gpsWarning, setGpsWarning] = useState<string | null>(null);
  const [autoPaused, setAutoPaused] = useState(false);
  const [splitBanner, setSplitBanner] = useState<string | null>(null);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [hrZone, setHrZone] = useState<HrZoneInfo | null>(null);

  return {
    gpsWarning,
    setGpsWarning,
    autoPaused,
    setAutoPaused,
    splitBanner,
    setSplitBanner,
    showTypePicker,
    setShowTypePicker,
    hrZone,
    setHrZone,
  };
}
