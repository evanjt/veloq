import { useEffect, useRef } from 'react';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useHRZones } from '@/features/fitness';
import type { HrZoneInfo } from '../components/DataFieldGrid';

export function useHrZoneColorEffect(
  heartrateLength: number,
  setHrZone: (zone: HrZoneInfo | null) => void
) {
  const hrZones = useHRZones((s) => s.zones);
  const maxHR = useHRZones((s) => s.maxHR);
  const prevColorRef = useRef<string | null>(null);

  useEffect(() => {
    const heartrate = useRecordingStore.getState().streams.heartrate;
    const lastHR = heartrate[heartrate.length - 1];
    if (!lastHR || lastHR <= 0 || !maxHR) {
      prevColorRef.current = null;
      setHrZone(null);
      return;
    }

    const hrPercent = lastHR / maxHR;
    let zone: HrZoneInfo | null = null;
    for (let i = 0; i < hrZones.length; i++) {
      if (hrPercent >= hrZones[i].min && hrPercent < hrZones[i].max) {
        zone = { color: hrZones[i].color, zone: i + 1 };
        break;
      }
    }
    // If above all zones, use the last zone
    if (!zone && hrPercent >= 1.0 && hrZones.length > 0) {
      zone = { color: hrZones[hrZones.length - 1].color, zone: hrZones.length };
    }

    if (zone && zone.color !== prevColorRef.current) {
      prevColorRef.current = zone.color;
      setHrZone(zone);
    }
  }, [heartrateLength, hrZones, maxHR]); // eslint-disable-line react-hooks/exhaustive-deps
}
