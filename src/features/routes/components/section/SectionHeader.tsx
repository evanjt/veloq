/**
 * Section detail hero: DetailHero frame around SectionMapView with
 * editable name and traversal stats.
 */

import React from 'react';
import { StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { pressable, pressRipple } from '@/shared/ui/pressFeedback';
import { useMetricSystem } from '@/shared/app';
import {
  DetailHero,
  HeroStatsRow,
  useHeroHeaderBottom,
  useHeroMapHeight,
  Shimmer,
  SkeletonFrame,
} from '@/shared/ui';
import { PlaceNameKind } from 'veloqrs';
import { SectionNameEditor } from './SectionNameEditor';
import { PlaceNameButton } from '../PlaceNameButton';
import { HighlightedSectionMap } from './HighlightedSectionMap';
import type { MapHighlightStore } from '@/features/routes/lib/mapHighlight';
import type { SectionDeltaLine } from '@/features/routes/lib/deltaLayout';
import { type MaterialIconName } from '@/shared/activity/activityUtils';
import { heroStats } from '@/features/routes/lib/heroStats';
import type { NameSaveOutcome } from '@/features/routes/lib/sectionRenameFailure';
import {
  colors,
  iconSize,
  layout,
  opacity,
  slopToMinTapTarget,
  spacing,
  typography,
} from '@/theme';
import type { RoutePoint, FrequentSection } from '@/types';
import type { Period } from '@/shared/app/period';

export interface SectionHeaderProps {
  section: FrequentSection;
  mapHeight?: number | undefined;
  activityColor: string;
  iconName: MaterialIconName;
  /** Traversals the chart plots, absent until the lap times are read. */
  activityCount?: number | undefined;
  /** The sport the chart plots, which labels the count when it narrows it. */
  scopeSport?: string | undefined;
  /** Sports the read offers over the range; the sport labels the count past one. */
  sportsOffered?: number | undefined;
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
  onSaveName: (name: string) => Promise<NameSaveOutcome>;
  /** Whether the detail read lets the athlete ask for a name from the section's places. */
  canNameFromPlaces?: boolean | undefined;
}

/** The name a section's hero shows and its screen is titled with: the rename, its own, its id. */
export function sectionHeroName(
  section: Pick<FrequentSection, 'id' | 'name'>,
  customName: string | null | undefined
): string {
  return customName ?? section.name ?? section.id;
}

export function SectionHeader({
  section,
  activityColor,
  iconName,
  activityCount,
  scopeSport,
  sportsOffered = 0,
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
  canNameFromPlaces = false,
}: SectionHeaderProps) {
  const heroHeight = useHeroMapHeight();
  const headerBottom = useHeroHeaderBottom();
  const mapHeight = mapHeightProp ?? heroHeight;
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  const stats = heroStats(
    { kind: 'section', section },
    { count: activityCount, sport: scopeSport, sportsOffered, range: scopeRange ?? 'all' },
    t,
    isMetric
  );

  return (
    <DetailHero
      height={mapHeight}
      overlay={
        <>
          <SectionNameEditor
            name={sectionHeroName(section, customName)}
            startText={customName || section.name || ''}
            iconName={iconName}
            activityColor={activityColor}
            onSaveName={onSaveName}
            accessory={
              canNameFromPlaces && !isTrimming ? (
                <PlaceNameButton
                  kind={PlaceNameKind.Section}
                  itemId={section.id}
                  testID="section-place-name-button"
                />
              ) : undefined
            }
          />
          {section.isLift ? (
            <Pressable
              style={pressable(styles.liftBadge)}
              testID="section-lift-badge"
              accessibilityRole="button"
              accessibilityLabel={t('sections.notLift')}
              onPress={onUnflagLift}
              disabled={!onUnflagLift}
              android_ripple={pressRipple}
              hitSlop={liftBadgeSlop}
            >
              <MaterialCommunityIcons name="gondola" size={iconSize.sm} color={colors.textOnDark} />
              <Text style={styles.liftBadgeText}>{t('sections.liftGround')}</Text>
              {onUnflagLift ? (
                <MaterialCommunityIcons
                  name="close"
                  size={iconSize.sm}
                  color={colors.textOnDark}
                  testID="section-lift-unflag"
                />
              ) : null}
            </Pressable>
          ) : null}
          <HeroStatsRow testID="section-detail-stats" stats={stats} />
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
          headerBottom={headerBottom}
        />
      ) : (
        <SkeletonFrame testID="section-hero-skeleton" style={{ height: mapHeight }}>
          <Shimmer width="100%" height={mapHeight} borderRadius={0} />
        </SkeletonFrame>
      )}
    </DetailHero>
  );
}

const LIFT_BADGE_HEIGHT = typography.caption.lineHeight + 2 * spacing.xxs;
const liftBadgeSlop = slopToMinTapTarget(LIFT_BADGE_HEIGHT);

const styles = StyleSheet.create({
  // Its own row between the name and the stats, so a flagged section costs the
  // name no width and the rename affordance no room.
  liftBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
    paddingVertical: spacing.xxs,
    minHeight: LIFT_BADGE_HEIGHT,
    paddingHorizontal: spacing.sm,
    borderRadius: layout.borderRadiusFull,
    backgroundColor: opacity.overlay.scrim,
  },
  liftBadgeText: {
    ...typography.caption,
    color: colors.textOnDark,
    fontWeight: '600',
  },
});
