import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useMetricSystem } from '@/shared/app';
import { formatElevation } from '@/shared/format/format';
import { ABSENT } from '@/shared/format/absent';
import { SignalStatus, type SignalLevel } from '@/shared/ui';

interface GpsSignalIndicatorProps {
  accuracy: number | null;
}

export function GpsSignalIndicator({ accuracy }: GpsSignalIndicatorProps) {
  const isMetric = useMetricSystem();
  let level: SignalLevel;
  let icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];

  if (accuracy == null) {
    level = 'idle';
    icon = 'crosshairs-question';
  } else if (accuracy < 5) {
    level = 'ok';
    icon = 'crosshairs-gps';
  } else if (accuracy <= 15) {
    level = 'warn';
    icon = 'crosshairs';
  } else {
    level = 'bad';
    icon = 'crosshairs-question';
  }

  return (
    <SignalStatus
      level={level}
      icon={icon}
      label={accuracy == null ? ABSENT : formatElevation(accuracy, isMetric)}
    />
  );
}
