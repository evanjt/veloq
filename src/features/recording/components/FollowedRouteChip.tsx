import React from 'react';
import { useTranslation } from 'react-i18next';

import { useMetricSystem } from '@/shared/app';
import { formatDistance, formatDuration } from '@/shared/format/format';
import { FloatingPill } from '@/shared/ui/FloatingPill';

interface FollowedRouteChipProps {
  route: { name: string; distanceMeters: number; bestTimeSeconds: number | null };
  onStop: () => void;
}

/** The route being followed, with its length and best time, and the one press that stops it. */
export function FollowedRouteChip({ route, onStop }: FollowedRouteChipProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();

  const detail = [
    ...(route.distanceMeters > 0 ? [formatDistance(route.distanceMeters, isMetric)] : []),
    ...(route.bestTimeSeconds != null && route.bestTimeSeconds > 0
      ? [t('recording.routeOverlay.pr', { time: formatDuration(route.bestTimeSeconds) })]
      : []),
  ].join(' · ');

  return (
    <FloatingPill
      testID="followed-route"
      icon="map-marker-path"
      title={t('recording.routeOverlay.following', { name: route.name })}
      detail={detail || null}
      onDismiss={onStop}
    />
  );
}
