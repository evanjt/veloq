/**
 * Section detail hero: DetailHero frame around SectionMapView with
 * editable name and traversal stats.
 */

import React from 'react';
import { View, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useMetricSystem } from '@/shared/app';
import { DetailHero, HeroNameRow, HeroStatsRow, useHeroMapHeight } from '@/shared/ui';
import { SectionMapView } from '../SectionMapView';
import type { SectionDeltaLine } from '@/features/routes/lib/deltaLayout';
import { type MaterialIconName } from '@/shared/activity/activityUtils';
import { formatDistance, formatElevation } from '@/shared/format/format';
import { sectionElevation } from '@/features/routes/lib/sectionElevation';
import { colors, darkColors, layout, opacity, spacing, typography } from '@/theme';
import type { RoutePoint, FrequentSection } from '@/types';
import { PERIOD_LABEL_KEYS, type Period } from '@/shared/app/period';

export interface SectionHeaderProps {
  section: FrequentSection;
  mapHeight?: number | undefined;
  insetTop: number;
  activityColor: string;
  iconName: MaterialIconName;
  /** Traversals the chart plots, absent until the lap times are read. */
  activityCount?: number | undefined;
  /** The sport the count is for, given when the section has more than one. */
  scopeSport?: string | undefined;
  /** The sport the screen reads the section in, which styles the map. */
  sportType?: string | undefined;
  /** The range the count is over, left off for all time. */
  scopeRange?: Period | undefined;
  mapReady: boolean;
  isTrimming: boolean;
  isExpandMode: boolean;
  trimStart: number;
  trimEnd: number;
  expandContextPoints?: RoutePoint[] | null | undefined;
  isEditing: boolean;
  editName: string;
  customName: string | null;
  nameInputRef: React.RefObject<TextInput | null>;
  shadowTrack?: [number, number][] | undefined;
  highlightedActivityId: string | null;
  highlightedLapPoints?: RoutePoint[] | undefined;
  /** The attempt the chart's delta plot shows, which colours the section line. */
  deltaLine?: SectionDeltaLine | null | undefined;
  allActivityTraces?: Record<string, RoutePoint[]> | undefined;
  /** Take the detector's lift flag off. Absent leaves the badge inert. */
  onUnflagLift?: (() => void) | undefined;
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
  scopeSport,
  sportType,
  scopeRange,
  mapReady,
  mapHeight: mapHeightProp,
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
  deltaLine,
  allActivityTraces,
  onUnflagLift,
  onStartEditing,
  onSaveName,
  onCancelEdit,
  onEditNameChange,
}: SectionHeaderProps) {
  const heroHeight = useHeroMapHeight();
  const mapHeight = mapHeightProp ?? heroHeight;
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  const elevation = sectionElevation(section);
  const traversalScope = [
    `${activityCount} ${t('sections.traversals')}`,
    ...(scopeSport ? [t(`activityTypes.${scopeSport}`, scopeSport)] : []),
    ...(scopeRange && scopeRange !== 'all' ? [t(PERIOD_LABEL_KEYS.long[scopeRange])] : []),
  ].join(' · ');

  return (
    <DetailHero
      height={mapHeight}
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
            <TouchableOpacity
              style={styles.liftBadge}
              testID="section-lift-badge"
              accessibilityRole="button"
              accessibilityLabel={t('sections.notLift')}
              onPress={onUnflagLift}
              disabled={!onUnflagLift}
              activeOpacity={0.7}
            >
              <MaterialCommunityIcons name="gondola" size={12} color={colors.textOnDark} />
              <Text style={styles.liftBadgeText}>{t('sections.liftGround')}</Text>
              {onUnflagLift && (
                <MaterialCommunityIcons
                  name="close"
                  size={12}
                  color={colors.textOnDark}
                  testID="section-lift-unflag"
                />
              )}
            </TouchableOpacity>
          )}
          <HeroStatsRow
            stats={[
              formatDistance(section.distanceMeters, isMetric),
              ...(activityCount != null ? [traversalScope] : []),
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
          sportType={sportType}
          height={mapHeight}
          interactive={true}
          enableFullscreen={!isTrimming}
          shadowTrack={shadowTrack}
          highlightedActivityId={highlightedActivityId}
          highlightedLapPoints={highlightedLapPoints}
          deltaLine={deltaLine}
          allActivityTraces={allActivityTraces}
          trimRange={isTrimming ? { start: trimStart, end: trimEnd } : null}
          extensionTrack={isTrimming && isExpandMode ? expandContextPoints : null}
          insetTop={insetTop}
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
    paddingVertical: spacing.xxs,
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
