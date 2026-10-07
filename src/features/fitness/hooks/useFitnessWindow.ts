import { useCallback, useEffect, useState } from 'react';
import { useSharedValue } from 'react-native-reanimated';

import { DEFAULT_PERIOD } from '@/shared/app/period';
import type { FitnessEntry } from '@/shared/app/fitnessEntry';
import { useChartInteraction } from '@/shared/charts/useChartInteraction';
import type { TimeRange } from '@/features/wellness';

/**
 * The range the Fitness tab shows and the day pinned in it.
 *
 * A card that summarised a window links here with it. The tab stays mounted
 * once opened, so the entry is taken whenever it arrives rather than only
 * seeding the first render, and it is cleared once taken so going back does
 * not apply it again. Clearing it changes nothing on screen: only a range the
 * athlete picks drops the pinned day, since that day may lie outside the new
 * window.
 */
export function useFitnessWindow(entry: FitnessEntry, clearEntry: () => void) {
  const { range: entryRange, date: entryDate } = entry;
  const [timeRange, setTimeRange] = useState<TimeRange>(entryRange ?? DEFAULT_PERIOD);
  const interaction = useChartInteraction(entryDate);
  const { setSelectedDate, setSelectedValues } = interaction;
  // Shared with the charts for the crosshair, so it moves with the selection.
  const sharedSelectedIdx = useSharedValue(-1);

  // Taken while rendering, so the screen never commits a frame on the old
  // window. The first entry already seeded the state above.
  const entryKey = entryRange || entryDate ? `${entryRange ?? ''}|${entryDate ?? ''}` : null;
  const [takenEntry, setTakenEntry] = useState(entryKey);
  if (entryKey !== takenEntry) {
    setTakenEntry(entryKey);
    if (entryKey) {
      if (entryRange) setTimeRange(entryRange);
      setSelectedDate(entryDate);
      setSelectedValues(null);
    }
  }

  // The crosshair and the route params live outside React, so they follow in
  // an effect once the entry is on screen.
  useEffect(() => {
    if (!entryKey) return;
    sharedSelectedIdx.set(-1);
    clearEntry();
  }, [entryKey, clearEntry, sharedSelectedIdx]);

  const changeTimeRange = useCallback(
    (next: TimeRange) => {
      setTimeRange(next);
      sharedSelectedIdx.set(-1);
      setSelectedDate(null);
      setSelectedValues(null);
    },
    [setSelectedDate, setSelectedValues, sharedSelectedIdx]
  );

  return { ...interaction, timeRange, changeTimeRange, sharedSelectedIdx };
}
