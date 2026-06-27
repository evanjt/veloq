import { useState } from 'react';

export function useRecordingScreenState() {
  const [isLocked, setIsLocked] = useState(true);
  const [gpsWarning, setGpsWarning] = useState<string | null>(null);
  const [autoPaused, setAutoPaused] = useState(false);
  const [splitBanner, setSplitBanner] = useState<string | null>(null);
  const [showTypePicker, setShowTypePicker] = useState(false);
  const [hrZoneColor, setHrZoneColor] = useState<string | null>(null);

  return {
    isLocked,
    setIsLocked,
    gpsWarning,
    setGpsWarning,
    autoPaused,
    setAutoPaused,
    splitBanner,
    setSplitBanner,
    showTypePicker,
    setShowTypePicker,
    hrZoneColor,
    setHrZoneColor,
  };
}
