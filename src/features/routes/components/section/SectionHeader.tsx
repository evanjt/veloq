/**
 * Section detail hero: DetailHero frame around SectionMapView with
 * editable name and traversal stats.
 */

import React from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { ActivityIndicator, Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { pressable, pressRipple } from '@/shared/ui/pressFeedback';
import { useMetricSystem } from '@/shared/app';
import { DetailHero, HeroStatsRow, useHeroMapHeight } from '@/shared/ui';
import { SectionNameEditor } from './SectionNameEditor';
import { HighlightedSectionMap } from './HighlightedSectionMap';
import type { MapHighlightStore } from '@/features/routes/lib/mapHighlight';
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
  /** The committed name override, which takes precedence over `section.name`. */
  customName: string | null;
  shadowTrack?: [number, number][] | undefined;
  /** The chart's scrubbed attempt. Only the map reads it, so a scrub never renders the header. */
  highlight: MapHighlightStore;
  /** The attempt the chart's delta plot shows, which colours the section line. */
  deltaLine?: SectionDeltaLine | null | undefined;
  allActivityTraces?: Record<string, RoutePoint[]> | undefined;
  /** Take the detector's lift flag off. Absent leaves the badge inert. */
  onUnflagLift?: (() => void) | undefined;
  /** Called with the typed name, untrimmed, when the rename is saved. */
  onSaveName: (name: string) => void;
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
  customName,
  shadowTrack,
  highlight,
  deltaLine,
  allActivityTraces,
  onUnflagLift,
  onSaveName,
}: SectionHeaderProps) {
  const heroHeight = useHeroMapHeight();
  const mapHeight = mapHeightProp ?? heroHeight;
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  const elevation = sectionElevation(section);
  const traversalScope = [
    t('sections.traversalsCount', { count: activityCount ?? 0 }),
    ...(scopeSport ? [t(`activityTypes.${scopeSport}`, scopeSport)] : []),
    ...(scopeRange && scopeRange !== 'all' ? [t(PERIOD_LABEL_KEYS.long[scopeRange])] : []),
  ].join(' · ');

  return (
    <DetailHero
      height={mapHeight}
      overlay={
        <>
          <SectionNameEditor
            name={customName ?? section.name ?? section.id}
            startText={customName || section.name || ''}
            iconName={iconName}
            activityColor={activityColor}
            onSaveName={onSaveName}
          />
          {section.isLift && (
            <Pressable
              style={pressable(styles.liftBadge)}
              testID="section-lift-badge"
              accessibilityRole="button"
              accessibilityLabel={t('sections.notLift')}
              onPress={onUnflagLift}
              disabled={!onUnflagLift}
              android_ripple={pressRipple}
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
            </Pressable>
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
        <HighlightedSectionMap
          highlight={highlight}
          section={section}
          sportType={sportType}
          height={mapHeight}
          interactive={true}
          enableFullscreen={!isTrimming}
          shadowTrack={shadowTrack}
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
