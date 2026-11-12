import { useEffect, type MutableRefObject } from 'react';

import { useRecordingStore } from '../stores/RecordingStore';
import { useRecordingLiveStore } from '../stores/RecordingLiveStore';

/**
 * A route chosen on the entry screen belongs to the ride it starts. When the screen is left
 * without starting and no ride is under way, `started` is still false and the choice is forgotten, so a later visit,
 * possibly elsewhere, begins with no route followed.
 */
export function useForgetAbandonedRouteChoice(started: MutableRefObject<boolean>): void {
  useEffect(
    () => () => {
      if (started.current || useRecordingStore.getState().status !== 'idle') return;
      useRecordingLiveStore.getState().clearRouteChoice();
    },
    [started]
  );
}
