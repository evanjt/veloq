import React, { useEffect, useRef, type ReactNode } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { FfiFollowDirection, FfiFollowStatus } from 'veloqrs';

import { useMetricSystem, useTheme } from '@/shared/app';
import { formatDistance, formatDuration } from '@/shared/format/format';
import { FloatingPill } from '@/shared/ui/FloatingPill';
import { medium } from '@/shared/ui/haptics';
import { Icon } from '@/shared/ui/Icon';
import { colors, darkColors, iconSize } from '@/theme';
import { useRecordingLiveStore } from '../stores/RecordingLiveStore';
import { turnCue } from '../lib/routeTurnCue';

const TURN_KEY = {
  left: 'recording.guidance.turnLeft',
  right: 'recording.guidance.turnRight',
  back: 'recording.guidance.turnBack',
} as const;

const TURN_ICON = {
  left: 'arrow-left',
  right: 'arrow-right',
  back: 'arrow-u-left-top',
} as const;

interface FollowedRouteChipProps {
  route: { name: string; distanceMeters: number; bestTimeSeconds: number | null };
  onStop: () => void;
}

/**
 * The route being followed, with the guidance the engine keeps for the ride and the one press
 * that stops it: the distance left, a turn within 150 m, how far away an unjoined route is, or a
 * warning with an arrow back once the ride is off the route. With no guidance it shows the
 * route's length and best time.
 */
export function FollowedRouteChip({ route, onStop }: FollowedRouteChipProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  const { isDark } = useTheme();
  const guidance = useRecordingLiveStore((s) => s.guidance);
  const heading = useRecordingLiveStore((s) => s.heading);

  const offRoute = guidance?.status === FfiFollowStatus.OffRoute;
  const wasOffRoute = useRef(false);
  useEffect(() => {
    if (offRoute && !wasOffRoute.current) medium();
    wasOffRoute.current = offRoute;
  }, [offRoute]);

  const pr =
    route.bestTimeSeconds != null && route.bestTimeSeconds > 0
      ? [t('recording.routeOverlay.pr', { time: formatDuration(route.bestTimeSeconds) })]
      : [];
  const wholeLength =
    route.distanceMeters > 0 ? [formatDistance(route.distanceMeters, isMetric)] : [];

  let title = t('recording.routeOverlay.following', { name: route.name });
  let lengthPart = wholeLength;
  let warningTitle = false;
  let arrowDeg: number | null = null;
  const onRoute = guidance?.status === FfiFollowStatus.OnRoute;
  const turn = onRoute ? turnCue(guidance.nextTurn) : null;
  const turnPart = turn
    ? [t(TURN_KEY[turn.kind], { distance: formatDistance(turn.distanceM, isMetric) })]
    : [];

  if (onRoute) {
    if (guidance.direction !== FfiFollowDirection.Undecided) {
      lengthPart = [
        t('recording.guidance.remaining', {
          distance: formatDistance(guidance.remainingM, isMetric),
        }),
      ];
    }
  } else if (guidance?.status === FfiFollowStatus.NotJoined) {
    lengthPart = [
      t('recording.guidance.notJoined', {
        distance: formatDistance(guidance.crossTrackM, isMetric),
      }),
    ];
  } else if (guidance && offRoute) {
    title = t('recording.guidance.offRoute', {
      distance: formatDistance(guidance.crossTrackM, isMetric),
    });
    lengthPart = [];
    warningTitle = true;
    arrowDeg = (((guidance.bearingToRouteDeg - (heading ?? 0)) % 360) + 360) % 360;
  }

  const detail = [...turnPart, ...lengthPart, ...pr].join(' · ');
  const palette = isDark ? darkColors : colors;

  let lead: ReactNode = null;
  if (turn) {
    lead = (
      <View testID="followed-route-turn">
        <Icon name={TURN_ICON[turn.kind]} size={iconSize.sm} color={palette.textPrimary} />
      </View>
    );
  }
  if (arrowDeg !== null) {
    lead = (
      <View testID="followed-route-arrow" style={{ transform: [{ rotate: `${arrowDeg}deg` }] }}>
        <Icon name="arrow-up" size={iconSize.sm} color={palette.warningText} />
      </View>
    );
  }

  return (
    <FloatingPill
      testID="followed-route"
      icon="map-marker-path"
      lead={lead}
      title={title}
      {...(warningTitle ? { titleColor: palette.warningText } : null)}
      detail={detail || null}
      onDismiss={onStop}
    />
  );
}
