import React, { memo, useRef } from 'react';
import { Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useMetricSystem } from '@/shared/app';
import { formatDistance } from '@/shared/format/format';
import { SportIcons } from '@/shared/activity/SportIcons';
import type { FrequentSection } from '@/types';
import { useFocusOnAppear } from '@/shared/ui/useFocusOnAppear';
import { MapPopup } from './MapPopup';

import { iconSize } from '@/theme';
interface SectionPopupProps {
  section: FrequentSection;
  bottom: number;
  onClose: () => void;
  onViewDetails?: () => void;
}

export const SectionPopup = memo(function SectionPopup({
  section,
  bottom,
  onClose,
  onViewDetails,
}: SectionPopupProps) {
  const { t } = useTranslation();
  const titleRef = useRef<Text>(null);
  useFocusOnAppear(titleRef, section.id);
  const isMetric = useMetricSystem();

  // Names are stored in Rust (user-set or auto-generated on creation/migration)
  const displayName = section.name ?? section.id;

  return (
    <MapPopup
      testID="section-popup"
      titleTestID="section-popup-title"
      closeTestID="section-popup-close"
      style={{ bottom }}
      titleRef={titleRef}
      title={displayName}
      subtitle={`${t('sections.traversalsCount', { count: section.visitCount })} · ${formatDistance(
        section.distanceMeters,
        isMetric
      )}`}
      stats={[
        // Every sport that has taken the ground, in one colour: none is the section's.
        {
          key: 'sports',
          renderIcon: (color) => (
            <SportIcons sportTypes={section.sportTypes} size={iconSize.md} color={color} />
          ),
        },
        {
          key: 'activities',
          icon: 'run',
          value: t('sections.activitiesCount', { count: section.activityIds.length }),
        },
        {
          key: 'routes',
          icon: 'map-marker-path',
          value: t('sections.routesCountLabel', { count: section.routeIds?.length ?? 0 }),
        },
      ]}
      viewDetails={
        onViewDetails ? { testID: 'section-popup-view-details', onPress: onViewDetails } : undefined
      }
      closeLabel={t('maps.closeSectionPopup')}
      onClose={onClose}
    />
  );
});
