import { useEffect, useRef } from 'react';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useHRZones } from '@/features/fitness';

export function useHrZoneColorEffect(
  heartrateLength: number,
  setHrZoneColor: (color: string | null) => void
) {
  const hrZones = useHRZones((s) => s.zones);
  const maxHR = useHRZones((s) => s.maxHR);
  const prevHrZoneColorRef = useRef<string | null>(null);

  useEffect(() => {
    const heartrate = useRecordingStore.getState().streams.heartrate;
    const lastHR = heartrate[heartrate.length - 1];
    if (!lastHR || lastHR <= 0 || !maxHR) {
      setHrZoneColor(null);
      return;
    }

    const hrPercent = lastHR / maxHR;
    let zoneColor: string | null = null;
    for (const zone of hrZones) {
      if (hrPercent >= zone.min && hrPercent < zone.max) {
        zoneColor = zone.color;
        break;
      }
    }
    // If above all zones, use the last zone colour
    if (!zoneColor && hrPercent >= 1.0 && hrZones.length > 0) {
      zoneColor = hrZones[hrZones.length - 1].color;
    }

    if (zoneColor && zoneColor !== prevHrZoneColorRef.current) {
      prevHrZoneColorRef.current = zoneColor;
      setHrZoneColor(zoneColor);
    }
  }, [heartrateLength, hrZones, maxHR]); // eslint-disable-line react-hooks/exhaustive-deps
}
