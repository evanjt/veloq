/**
 * The top of a section's card in its map sheet, which is what Peek shows: the name, tap to
 * rename, the date line, and the distance, the traversals and the best time. The lift flag, when
 * the detector set one, and the climbing and the grades follow under it.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useMetricSystem, useTheme } from '@/shared/app';
import { MapSheetCardCloseSpace } from '@/shared/app/MapSheetCards';
import { HeroStatsRow } from '@/shared/ui';
import { FitText } from '@/shared/ui/FitText';
import { PressTarget } from '@/shared/ui/PressTarget';
import { Icon } from '@/shared/ui/Icon';
import { SectionNameEditor } from './SectionNameEditor';
import { type MaterialIconName } from '@/shared/activity/activityUtils';
import { sectionClimbStats } from '@/features/routes/lib/heroStats';
import { detailDateLine, detailPeekStats } from '@/features/routes/lib/detailPeek';
import type { NameSaveOutcome } from '@/features/routes/lib/sectionRenameFailure';
import { iconSize, layout, slopToMinTapTarget, spacing, themePalette, typography } from '@/theme';
import type { FrequentSection } from '@/types';
import type { Period } from '@/shared/app/period';

export interface SectionHeaderProps {
  section: FrequentSection;
  activityColor: string;
  iconName: MaterialIconName;
  /** Traversals the chart plots, absent until the lap times are read. */
  activityCount?: number | undefined;
  /** The sport the chart plots, which the date line names when it narrows the count. */
  scopeSport?: string | undefined;
  /** Sports the read offers over the range; the sport is named past one. */
  sportsOffered?: number | undefined;
  /** The range the count is over, left off for all time. */
  scopeRange?: Period | undefined;
  /** The fastest traversal's time, in seconds, absent until the lap times are read. */
  bestTimeSecs?: number | undefined;
  /** The first and the last traversal in the range. */
  firstDate?: Date | null | undefined;
  lastDate?: Date | null | undefined;
  /** The committed name override, which takes precedence over `section.name`. */
  customName: string | null;
  /** Take the detector's lift flag off. Absent leaves the badge inert. */
  onUnflagLift?: (() => void) | undefined;
  /** Called with the typed name, untrimmed, when the rename is saved. */
  onSaveName: (name: string) => Promise<NameSaveOutcome>;
}

/** The name a section's card shows and its screen is titled with: the rename, its own, its id. */
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
  scopeRange,
  bestTimeSecs,
  firstDate = null,
  lastDate = null,
  customName,
  onUnflagLift,
  onSaveName,
}: SectionHeaderProps) {
  const { t } = useTranslation();
  const isMetric = useMetricSystem();
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const peek = {
    kind: 'section' as const,
    distanceMeters: section.distanceMeters,
    scope: {
      count: activityCount,
      sport: scopeSport,
      sportsOffered,
      range: scopeRange ?? 'all',
    },
    bestTimeSecs,
    firstDate,
    lastDate,
  };
  const dateLine = detailDateLine(peek, t);
  const climb = sectionClimbStats(section, t, isMetric);

  return (
    <View testID="section-card-peek" style={styles.peek}>
      <SectionNameEditor
        onSurface
        name={sectionHeroName(section, customName)}
        startText={customName || section.name || ''}
        iconName={iconName}
        activityColor={activityColor}
        onSaveName={onSaveName}
        accessory={<MapSheetCardCloseSpace />}
      />
      {dateLine ? (
        <FitText
          testID="section-card-date-line"
          style={[styles.dateLine, { color: palette.textSecondary }]}
        >
          {dateLine}
        </FitText>
      ) : null}
      <HeroStatsRow
        onSurface
        testID="section-detail-stats"
        stats={detailPeekStats(peek, t, isMetric)}
      />
      {section.isLift ? (
        <PressTarget
          style={[styles.liftBadge, { backgroundColor: palette.surfaceRaised }]}
          testID="section-lift-badge"
          accessibilityRole="button"
          accessibilityLabel={t('sections.notLift')}
          onPress={onUnflagLift}
          disabled={!onUnflagLift}
          hitSlop={liftBadgeSlop}
        >
          <Icon name="gondola" size={iconSize.sm} color={palette.textSecondary} />
          <Text style={[styles.liftBadgeText, { color: palette.textPrimary }]}>
            {t('sections.liftGround')}
          </Text>
          {onUnflagLift ? (
            <Icon
              name="close"
              size={iconSize.sm}
              color={palette.textSecondary}
              testID="section-lift-unflag"
            />
          ) : null}
        </PressTarget>
      ) : null}
      {climb.length > 0 ? (
        <HeroStatsRow onSurface testID="section-detail-climb" stats={climb} />
      ) : null}
    </View>
  );
}

const LIFT_BADGE_HEIGHT = typography.caption.lineHeight + 2 * spacing.xxs;
const liftBadgeSlop = slopToMinTapTarget(LIFT_BADGE_HEIGHT);

const styles = StyleSheet.create({
  peek: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  // Its own row under the numbers, so a flagged section costs the name no width, the rename
  // affordance no room and Peek none of its lines.
  liftBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.xxs,
    minHeight: LIFT_BADGE_HEIGHT,
    paddingHorizontal: spacing.sm,
    borderRadius: layout.borderRadiusFull,
  },
  liftBadgeText: {
    ...typography.captionBold,
  },
  dateLine: {
    ...typography.bodyCompact,
  },
});
