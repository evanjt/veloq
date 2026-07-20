import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { SignalStatus, type SignalLevel } from '@/shared/ui';

interface GpsSignalIndicatorProps {
  accuracy: number | null;
}

export function GpsSignalIndicator({ accuracy }: GpsSignalIndicatorProps) {
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
      label={accuracy == null ? '--' : `${Math.round(accuracy)}m`}
    />
  );
}
