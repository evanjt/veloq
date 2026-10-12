import { useEffect, useRef } from 'react';

import { engineHrZone } from '@/shared/native/hrZone';
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
  const prevZoneRef = useRef<number | null>(null);

  useEffect(() => {
    // The live value moves every second, so the screen is told only when the
    // zone it paints changes.
    const number = heartrate > 0 ? engineHrZone(sportType, heartrate) : null;
    if (number === prevZoneRef.current) return;
    prevZoneRef.current = number;
    setHrZone(number === null ? null : { zone: number });
  }, [heartrate, sportType, setHrZone]);
}
