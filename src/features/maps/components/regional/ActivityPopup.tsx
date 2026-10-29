import React, { memo, useMemo, useEffect, useRef } from 'react';
import { Animated, type TextInstance } from 'react-native';
import { useTranslation } from 'react-i18next';
import { formatDistance, formatDuration, formatFullDateWithWeekday } from '@/shared/format/format';
import { useMetricSystem } from '@/shared/app';
import { getActivityIcon } from '@/shared/activity/activityUtils';
import type { ActivityBoundsItem, ActivityMapData } from '@/types';
import { useFocusOnAppear } from '@/shared/ui/useFocusOnAppear';
import { motionSpring, motionTiming } from '@/shared/ui/reduceMotion';
import { duration } from '@/theme';
import { MapPopup } from './MapPopup';

const FADE_IN_MS = duration.instant;

export interface SelectedActivity {
  activity: ActivityBoundsItem;
  mapData: ActivityMapData | null;
  isLoading: boolean;
}

interface ActivityPopupProps {
  selected: SelectedActivity | null;
  bottom: number;
  /** Tallest the card may grow before its body scrolls */
  maxHeight?: number | undefined;
  onZoom: () => void;
  onClose: () => void;
  onViewDetails: () => void;
}

/**
 * Activity popup - always mounted for instant show/hide.
 * Uses opacity + pointerEvents instead of mount/unmount.
 */
export const ActivityPopup = memo(function ActivityPopup({
  selected,
  bottom,
  maxHeight,
  onZoom,
  onClose,
  onViewDetails,
}: ActivityPopupProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();

  const activityType = selected?.activity.type;
  const activityDate = selected?.activity.date;
  const activityDistance = selected?.activity.distance;
  const activityDuration = selected?.activity.duration;

  // Memoize icon name
  const activityIcon = useMemo(
    () => (activityType ? getActivityIcon(activityType) : 'run'),
    [activityType]
  );

  // Memoize formatted values
  const formattedDate = useMemo(
    () => (activityDate ? formatFullDateWithWeekday(activityDate) : ''),
    [activityDate]
  );

  const formattedDistance = useMemo(
    () => (activityDistance === undefined ? '' : formatDistance(activityDistance, isMetric)),
    [activityDistance, isMetric]
  );

  const formattedDuration = useMemo(
    () => (activityDuration === undefined ? '' : formatDuration(activityDuration)),
    [activityDuration]
  );

  // Always render but hide when no selection - avoids mount/unmount overhead
  const isVisible = !!selected;

  // Animate opacity for smooth show/hide
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(12)).current;
  const titleRef = useRef<TextInstance>(null);
  useFocusOnAppear(titleRef, selected?.activity.id, FADE_IN_MS);

  useEffect(() => {
    if (isVisible) {
      // Animate in - fast for snappy feel
      Animated.parallel([
        motionTiming(opacity, {
          toValue: 1,
          duration: FADE_IN_MS,
          useNativeDriver: true,
        }),
        motionSpring(translateY, {
          toValue: 0,
          tension: 300,
          friction: 20,
          useNativeDriver: true,
        }),
      ]).start();
    } else {
      // Animate out - instant
      opacity.setValue(0);
      translateY.setValue(12);
    }
  }, [isVisible, opacity, translateY]);

  // Don't render content when not visible (prevents empty popup flash)
  if (!isVisible) {
    return null;
  }

  return (
    <MapPopup
      testID="activity-popup"
      titleTestID="activity-popup-title"
      closeTestID="activity-popup-close"
      style={{ bottom, maxHeight, opacity, transform: [{ translateY }] }}
      titleRef={titleRef}
      title={selected?.activity.name ?? ''}
      subtitle={formattedDate}
      stats={[
        {
          key: 'sport',
          icon: activityIcon,
          value: activityType ? t(`activityTypes.${activityType}`, activityType) : '',
        },
        { key: 'distance', icon: 'map-marker-distance', value: formattedDistance },
        {
          key: 'time',
          icon: 'clock-outline',
          value: formattedDuration ? t('activity.movingTime', { duration: formattedDuration }) : '',
        },
      ]}
      viewDetails={{ testID: 'activity-popup-view-details', onPress: onViewDetails }}
      zoom={{ testID: 'activity-popup-zoom', label: t('maps.zoomToActivity'), onPress: onZoom }}
      closeLabel={t('maps.closePopup')}
      onClose={onClose}
    />
  );
});
