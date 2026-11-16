import { useState } from 'react';

import { readPlannedWorkout } from '@/features/recording/lib/plannedWorkout';
import { engineLineText } from '@/features/recording/lib/planFollow';
import { useLiveStrengthSession } from '@/features/recording/hooks/useLiveStrengthSession';
import type { ActivityType } from '@/types';

import { StrengthLiveSession } from './StrengthLiveSession';
import { StrengthReview } from './StrengthReview';
import { StrengthStart } from './StrengthStart';

/**
 * The strength recorder: the start screen with no session, the session screen while one is live
 * and the review once it is finished. Which of the three shows is the engine's answer to whether
 * a session is live, so a restarted app opens where it was.
 */
export function StrengthRecorder({
  activityType,
  pairedEventId,
}: {
  activityType: ActivityType;
  pairedEventId?: number | undefined;
}) {
  const live = useLiveStrengthSession();
  // Read once on arrival: the plan the athlete starts from must not move when a sync lands.
  const [plan] = useState(() => {
    const read = pairedEventId == null ? null : readPlannedWorkout(pairedEventId);
    return read ? { name: read.name, lines: read.lines.map(engineLineText) } : null;
  });
  const [finishedAt, setFinishedAt] = useState<number | null>(null);

  if (live.session && finishedAt != null) {
    return (
      <StrengthReview
        session={live.session}
        finishedAt={finishedAt}
        activityType={activityType}
        pairedEventId={pairedEventId}
      />
    );
  }
  if (!live.session) {
    return (
      <StrengthStart
        start={live.start}
        refused={live.refused}
        plan={plan ? { ...plan, start: live.startFromPlan } : null}
      />
    );
  }
  return <StrengthLiveSession live={live} onFinish={() => setFinishedAt(Date.now() / 1000)} />;
}
