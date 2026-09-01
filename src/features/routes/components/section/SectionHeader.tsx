/**
 * Section detail hero: DetailHero frame around SectionMapView with
 * editable name and traversal stats.
 */

import React from 'react';
import { View, StyleSheet, TextInput, Dimensions } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useMetricSystem } from '@/shared/app';
import { DetailHero, HeroNameRow, HeroStatsRow } from '@/shared/ui';
import { SectionMapView } from '../SectionMapView';
import { type MaterialIconName } from '@/features/activity/lib/activityUtils';
import { formatDistance, formatElevation } from '@/shared/format/format';
import { sectionElevation } from '@/features/routes/lib/sectionElevation';
import { colors, darkColors, layout, opacity, spacing, typography } from '@/theme';
import type { RoutePoint, FrequentSection } from '@/types';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAP_HEIGHT_NORMAL = Math.round(SCREEN_HEIGHT * 0.42);
const MAP_HEIGHT_EDIT = Math.round(SCREEN_HEIGHT * 0.6);
export { MAP_HEIGHT_NORMAL, MAP_HEIGHT_EDIT };

export interface SectionHeaderProps {
  section: FrequentSection;
  mapHeight?: number;
  insetTop: number;
  activityColor: string;
  iconName: MaterialIconName;
  activityCount: number;
  /** Mean heart rate across the included laps, when any carried one. */
  avgHr?: number | null;
  mapReady: boolean;
  isTrimming: boolean;
  isExpandMode: boolean;
  trimStart: number;
  trimEnd: number;
  expandContextPoints?: RoutePoint[] | null;
  isEditing: boolean;
  editName: string;
  customName: string | null;
  nameInputRef: React.RefObject<TextInput | null>;
  shadowTrack?: [number, number][];
  highlightedActivityId: string | null;
  highlightedLapPoints?: RoutePoint[];
  allActivityTraces?: Record<string, RoutePoint[]>;
  nearbyPolylines?: {
    id: string;
    name?: string;
    sportType: string;
    distanceMeters: number;
    visitCount: number;
    encodedPolyline: ArrayBuffer;
  }[];
  onNearbyPress?: (sectionId: string) => void;
  onBack: () => void;
  onStartEditing: () => void;
  onSaveName: () => void;
  onCancelEdit: () => void;
  onEditNameChange: (text: string) => void;
}

export function SectionHeader({
  section,
  insetTop,
  activityColor,
  iconName,
  activityCount,
  avgHr = null,
  mapReady,
  mapHeight = MAP_HEIGHT_NORMAL,
  isTrimming,
  isExpandMode,
  trimStart,
  trimEnd,
  expandContextPoints,
  isEditing,
  editName,
  customName,
  nameInputRef,
  shadowTrack,
  highlightedActivityId,
  highlightedLapPoints,
  allActivityTraces,
  nearbyPolylines,
  onNearbyPress,
  onBack,
  onStartEditing,
  onSaveName,
  onCancelEdit,
  onEditNameChange,
}: SectionHeaderProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  const elevation = sectionElevation(section);

  return (
    <DetailHero
      height={mapHeight}
      insetTop={insetTop}
      onBack={onBack}
      overlay={
        <>
          <HeroNameRow
            name={customName ?? section.name ?? section.id}
            icon={{ name: iconName, color: activityColor }}
            editable={{
              isEditing,
              editName,
              inputRef: nameInputRef,
              placeholder: t('sections.sectionNamePlaceholder'),
              testIDPrefix: 'section',
              onStartEdit: onStartEditing,
              onSave: onSaveName,
              onCancel: onCancelEdit,
              onChange: onEditNameChange,
            }}
          />
          {section.isLift && (
            <View style={styles.liftBadge} testID="section-lift-badge">
              <MaterialCommunityIcons name="gondola" size={12} color={colors.textOnDark} />
              <Text style={styles.liftBadgeText}>{t('sections.liftGround')}</Text>
            </View>
          )}
          <HeroStatsRow
            stats={[
              formatDistance(section.distanceMeters, isMetric),
              `${activityCount} ${t('sections.traversals')}`,
              ...(avgHr != null && avgHr > 0
                ? [`${t('sections.avgHr')} ${Math.round(avgHr)}`]
                : []),
              ...(elevation
                ? [
                    elevation.direction === 'loss'
                      ? `-${formatElevation(elevation.metres, isMetric)}`
                      : formatElevation(elevation.metres, isMetric),
                  ]
                : []),
              ...(elevation != null &&
              section.avgGradePercent != null &&
              Math.abs(section.avgGradePercent) >= 1.0
                ? [`${section.avgGradePercent.toFixed(1)}%`]
                : []),
              ...(section.maxGradePercent != null &&
              (section.klass === 'climb' || section.klass === 'descent')
                ? [`${t('sections.maxGrade')} ${section.maxGradePercent.toFixed(1)}%`]
                : []),
            ]}
          />
        </>
      }
    >
      {mapReady ? (
        <SectionMapView
          section={section}
          height={mapHeight}
          interactive={true}
          enableFullscreen={!isTrimming}
          shadowTrack={shadowTrack}
          highlightedActivityId={highlightedActivityId}
          highlightedLapPoints={highlightedLapPoints}
          allActivityTraces={allActivityTraces}
          trimRange={isTrimming ? { start: trimStart, end: trimEnd } : null}
          extensionTrack={isTrimming && isExpandMode ? expandContextPoints : null}
          nearbyPolylines={nearbyPolylines}
          onNearbyPress={onNearbyPress}
        />
      ) : (
        <View style={[styles.mapPlaceholder, { height: mapHeight }]}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      )}
    </DetailHero>
  );
}

const styles = StyleSheet.create({
  // Its own row between the name and the stats, so a flagged section costs the
  // name no width and the rename affordance no room.
  liftBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.chart.sm,
    marginTop: spacing.chart.sm,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    borderRadius: layout.borderRadiusFull,
    backgroundColor: opacity.overlay.scrim,
  },
  liftBadgeText: {
    ...typography.caption,
    color: colors.textOnDark,
    fontWeight: '600',
  },
  mapPlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: darkColors.background,
  },
});
