import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useMetricSystem } from '@/shared/app';
import { formatElevation } from '@/shared/format/format';
import { ABSENT } from '@/shared/format/absent';
import { SignalStatus } from '@/shared/ui';

import { gpsQuality, gpsSignalLevel, type GpsQuality } from '../lib/gpsQuality';
import { useRecordingPreferences } from '../stores/RecordingPreferencesStore';

interface GpsSignalIndicatorProps {
  accuracy: number | null;
}

const ICONS: Record<GpsQuality, React.ComponentProps<typeof MaterialCommunityIcons>['name']> = {
  none: 'crosshairs-question',
  good: 'crosshairs-gps',
  coarse: 'crosshairs',
  discarded: 'crosshairs-question',
};

export function GpsSignalIndicator({ accuracy }: GpsSignalIndicatorProps) {
  const isMetric = useMetricSystem();
  const rejectThreshold = useRecordingPreferences((s) => s.accuracyRejectThreshold);
  const quality = gpsQuality(accuracy, rejectThreshold);

  return (
    <SignalStatus
      level={gpsSignalLevel(quality)}
      icon={ICONS[quality]}
      label={accuracy == null ? ABSENT : formatElevation(accuracy, isMetric)}
    />
  );
}
