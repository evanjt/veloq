import React, { useMemo, useState } from 'react';

import type { ActivityType } from '@/types';
import { useHrZoneColorEffect } from '../hooks/useHrZoneColorEffect';
import { useRecordingMetrics } from '../hooks/useRecordingMetrics';
import { useTimer } from '../hooks/useTimer';
import { DataFieldGrid } from './DataFieldGrid';
import type { HrZoneInfo } from './DataFieldGrid';

type ConnectedDataFieldGridProps = Omit<
  React.ComponentProps<typeof DataFieldGrid>,
  'metrics' | 'hrZone' | 'activityType'
> & { activityType: ActivityType };

export function ConnectedDataFieldGrid(props: ConnectedDataFieldGridProps) {
  const baseMetrics = useRecordingMetrics();
  const { elapsedTime, movingTime } = useTimer();
  const [hrZone, setHrZone] = useState<HrZoneInfo | null>(null);
  useHrZoneColorEffect(baseMetrics.heartrate, props.activityType, setHrZone);

  const metrics = useMemo(
    () => ({ ...baseMetrics, elapsedTime, movingTime }),
    [baseMetrics, elapsedTime, movingTime]
  );

  return <DataFieldGrid {...props} metrics={metrics} hrZone={hrZone} />;
}
