import { useEffect, useRef } from 'react';
import { strength, type FfiLiveStrengthSession } from 'veloqrs';

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';

/**
 * Hands the engine each heart rate reading a paired sensor sends while the live strength session
 * has begun. The engine keeps the reading on the session, so the saved average and the FIT file
 * carry it; nothing is averaged here. A reading is sent once, however often the screen renders.
 */
export function useStrengthHeartRate(session: FfiLiveStrengthSession | null): void {
  const begun = session?.startedAt != null;
  const lastSent = useRef<number | null>(null);

  useEffect(() => {
    if (!begun) return undefined;
    const send = (sample: { value: number; at: number } | null | undefined) => {
      if (!sample || sample.at === lastSent.current) return;
      lastSent.current = sample.at;
      strength.recordLiveHeartRate(Math.round(sample.value), sample.at / 1000);
    };
    send(useRecordingStore.getState().latestSensor.heartrate);
    return useRecordingStore.subscribe((state, prev) => {
      if (state.latestSensor.heartrate !== prev.latestSensor.heartrate) {
        send(state.latestSensor.heartrate);
      }
    });
  }, [begun]);
}
