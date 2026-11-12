import { useMemo, useState } from 'react';

import { strength, type ExercisePickerData } from 'veloqrs';

import { useEngineRead } from '@/shared/native/useEngineSubscription';

import type { PickerFilterState } from '../lib/pickerFilter';

const NO_PICKER_DATA: ExercisePickerData = { rows: [], equipment: [], muscles: [] };

/** The exercise the athlete just did, whose usual followers lead the list. */
export interface JustDone {
  category: number;
  name: number;
}

/**
 * The picker's list from the engine, read again when a filter changes. The read is a tap-time
 * call, inside the 100 ms budget of a tap.
 */
export function useExercisePicker(
  filter: PickerFilterState,
  after: JustDone | null
): ExercisePickerData {
  // The ageing is in whole days, so the time the screen opened is fresh enough.
  const readEngine = useEngineRead(['activities', 'fitParsed']);
  const [now] = useState(() => Date.now() / 1000);
  const data = useMemo(
    () =>
      readEngine(() =>
        strength.getExercisePickerData(
          [...filter.equipment],
          filter.region ?? undefined,
          filter.muscle ?? undefined,
          filter.query,
          after?.category,
          after?.name,
          now
        )
      ),
    [filter, after?.category, after?.name, now, readEngine]
  );
  return data ?? NO_PICKER_DATA;
}
