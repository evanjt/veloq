import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { formatDuration } from '@/shared/format/format';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { LAP_BANNER_DURATION_MS } from '../lib/constants';

/**
 * The line that confirms a lap press: its number and moving time, for a few
 * seconds. A phone on a mount in sunlight, or a gloved press, gives no other
 * sign that the lap registered. Laps already taken when the screen mounts are
 * not announced again.
 */
export function useLapBanner(): string | null {
  const { t } = useTranslation();
  const [banner, setBanner] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return useRecordingStore.subscribe(({ laps }, previous) => {
      if (laps === previous.laps) return;
      const lap = laps[laps.length - 1];
      if (laps.length <= previous.laps.length || !lap) {
        // A new ride starts with no laps, and the last ride's lap is not its own.
        if (laps.length === 0) setBanner(null);
        return;
      }
      const lapStart = laps[laps.length - 2]?.movingEndTime ?? 0;
      setBanner(
        t('recording.lapBanner', {
          n: lap.index + 1,
          time: formatDuration(Math.max(0, lap.movingEndTime - lapStart)),
        })
      );
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setBanner(null), LAP_BANNER_DURATION_MS);
    });
  }, [t]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return banner;
}
