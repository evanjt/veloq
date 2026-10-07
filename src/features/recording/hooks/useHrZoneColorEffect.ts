import { useEffect, useRef } from 'react';

import { engineHrZone } from '@/shared/native/hrZone';
import { HR_ZONE_COLORS } from '@/shared/app/useSportSettings';
import type { HrZoneInfo } from '../components/DataFieldGrid';

/**
 * Tints the heart rate tile from `heartrate`, the live bpm the tile shows, with
 * the zone the engine names for `sportType` from the athlete's own zones.
 * The recorded stream grows only while recording, so reading it left the tint
 * behind the number while armed, waiting for a fix and paused.
 */
export function useHrZoneColorEffect(
  heartrate: number,
  sportType: string,
  setHrZone: (zone: HrZoneInfo | null) => void
) {
  const prevKeyRef = useRef<string | null>(null);

  useEffect(() => {
    // The live value moves every second, so the screen is told only when the
    // zone it paints changes.
    const number = heartrate > 0 ? engineHrZone(sportType, heartrate) : null;
    const zone: HrZoneInfo | null =
      number === null
        ? null
        : {
            zone: number,
            color: HR_ZONE_COLORS[Math.min(number, HR_ZONE_COLORS.length) - 1],
          };
    const key = zone ? `${zone.zone}:${zone.color}` : null;
    if (key === prevKeyRef.current) return;
    prevKeyRef.current = key;
    setHrZone(zone);
  }, [heartrate, sportType, setHrZone]);
}
