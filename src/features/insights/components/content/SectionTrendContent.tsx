import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import Animated, { FadeIn, LinearTransition } from 'react-native-reanimated';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useTheme } from '@/shared/app';
import { getActivityIcon } from '@/shared/activity/activityUtils';
import { useSectionPerformances } from '@/features/routes';
import { useSectionDetail } from '@/shared/native/useSectionDetail';
import { Shimmer } from '@/shared/ui/Shimmer';
import { navigateTo } from '@/shared/app/navigation';
import { RecentEffortsList } from './RecentEffortsList';
import { formatDuration } from '@/shared/format/format';
import { brand, colors, darkColors, iconSize, layout, opacity, spacing, typography } from '@/theme';
import type { Insight, SupportingSection } from '@/types';
import { SheetContext } from './SheetContext';
import { Button, Card, composeAccessibilityLabel, ErrorState, PressTarget } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import type { TFunc } from '../../types';
import { sectionRowKey, sectionWithSport } from '../../lib/cardSport';
import { rowTrendColor, rowTrendIcon, rowTrendWord } from '../../lib/rowTrend';
import { formatSignedPercent } from '@/shared/format/number';
import { NameText } from '@/shared/ui/NameText';

interface SectionTrendContentProps {
  insight: Insight;
}

function getClusterContext(
  sections: SupportingSection[],
  t: TFunction
): {
  heading: string;
  meta: string;
} {
  const uniqueSports = Array.from(
    new Set(
      sections
        .map((section) => section.sportType)
        .filter(
          (sportType): sportType is string => typeof sportType === 'string' && sportType.length > 0
        )
    )
  );
  const sport =
    uniqueSports.length === 1
      ? t(`activityTypes.${uniqueSports[0]}`, { defaultValue: uniqueSports[0] })
      : null;

  return {
    heading: sport
      ? t('insights.sectionTrendSheet.headingSport', { sport })
      : t('insights.sectionTrendSheet.heading'),
    meta: t('insights.sectionTrendSheet.meta'),
  };
}

/**
 * Expandable accordion item for a single section.
 * Always mounts the hook (no conditional hook calls) but only
 * fetches/renders effort data when expanded.
 *
 * The row opens the section's efforts in this sheet, and the expanded row
 * carries the link to the section itself, since the sheet hides its own.
 */
const SectionAccordionItem = React.memo(function SectionAccordionItem({
  section,
  expanded,
  onToggle,
}: {
  section: SupportingSection;
  expanded: boolean;
  onToggle: (rowKey: string) => void;
}) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const {
    section: fullSection,
    error: sectionError,
    retry: retrySection,
  } = useSectionDetail(expanded ? section.sectionId : null);
  // The trend's sport, which is what the row was ranked under. Read
  // unfiltered, the accordion opened on every sport's efforts.
  const {
    records,
    bests,
    isLoading,
    error: streamsError,
    refetch: refetchStreams,
  } = useSectionPerformances(expanded ? fullSection : null, section.sportType);

  const handleToggle = useCallback(() => {
    onToggle(sectionRowKey(section));
  }, [onToggle, section]);

  const handleOpenSection = useCallback(() => {
    navigateTo(`/section/${section.sectionId}`);
  }, [section.sectionId]);

  const name = sectionWithSport(section.sectionName, section.sportType, t as unknown as TFunc);
  const bestTime = section.bestTime != null ? formatDuration(section.bestTime) : null;
  const traversals =
    section.traversalCount != null
      ? t('sections.traversalsCount', { count: section.traversalCount })
      : null;
  // The change the card's bar for this row stands for. A row the engine
  // compared nothing on has no bar, so it prints none.
  const changeValue = section.ranking?.improvementChange;
  const change =
    changeValue != null && Number.isFinite(changeValue) ? formatSignedPercent(changeValue) : null;

  // The whole header is one toggle, so a screen reader meets each row once and
  // hears everything the row draws.
  // Rows below an opening row slide down rather than jump. A Reanimated
  // transition follows the system reduce-motion setting.
  return (
    <Animated.View layout={LinearTransition}>
      <Card variant="flat" padding="none">
        <PressTarget
          accessibilityRole="button"
          accessibilityLabel={composeAccessibilityLabel(
            name,
            section.hasRecentPR && t('a11y.personalRecord'),
            bestTime,
            traversals,
            change,
            rowTrendWord(section.trend)
          )}
          accessibilityState={{ expanded }}
          onPress={handleToggle}
          testID={`section-trend-toggle-${section.sectionId}`}
          style={styles.sectionHeader}
        >
          <View style={styles.sectionContent}>
            <View style={styles.sectionNameRow}>
              {section.sportType ? (
                <Icon
                  name={getActivityIcon(section.sportType)}
                  size={iconSize.sm}
                  color={isDark ? darkColors.textSecondary : colors.textSecondary}
                  style={styles.sportIcon}
                />
              ) : null}
              <NameText style={[styles.sectionName, isDark && styles.sectionNameDark]}>
                {name}
              </NameText>
              {section.hasRecentPR ? (
                <View style={styles.prChip}>
                  <Icon name="trophy" size={iconSize.xs} color={colors.textOnBright} />
                </View>
              ) : null}
            </View>
            <View style={styles.sectionMeta}>
              {bestTime != null ? (
                <Text style={[styles.bestTime, isDark && styles.bestTimeDark]}>{bestTime}</Text>
              ) : null}
              {traversals != null ? (
                <Text style={[styles.traversals, isDark && styles.traversalsDark]}>
                  {traversals}
                </Text>
              ) : null}
              {change != null && changeValue != null ? (
                <Text
                  testID="section-trend-change"
                  style={[styles.change, { color: rowTrendColor(Math.sign(changeValue), isDark) }]}
                >
                  {change}
                </Text>
              ) : null}
              <Icon
                name={rowTrendIcon(section.trend)}
                size={iconSize.sm}
                color={rowTrendColor(section.trend, isDark)}
              />
            </View>
          </View>

          <View style={styles.chevronButton}>
            <Icon
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={iconSize.md}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
            />
          </View>
        </PressTarget>

        {expanded ? (
          <Animated.View entering={FadeIn} style={styles.expandedContent}>
            {sectionError !== undefined ? (
              <ErrorState
                variant="inline"
                error={sectionError}
                onRetry={retrySection}
                testID="section-read-failure"
              />
            ) : streamsError ? (
              <ErrorState
                variant="inline"
                error={streamsError}
                onRetry={refetchStreams}
                testID="section-stream-failure"
              />
            ) : isLoading ? (
              <View style={[styles.shimmerRow, isDark && styles.shimmerRowDark]}>
                <Shimmer width="100%" height={40} borderRadius={8} />
              </View>
            ) : records.length > 0 ? (
              <RecentEffortsList records={records} bests={bests} />
            ) : (
              <Text style={[styles.noEfforts, isDark && styles.noEffortsDark]}>
                {t('insights.sectionTrendSheet.noEfforts')}
              </Text>
            )}
            <Button
              label={t('insights.viewInDetail')}
              variant="ghost"
              size="sm"
              onPress={handleOpenSection}
              testID={`section-trend-open-${section.sectionId}`}
            />
          </Animated.View>
        ) : null}
      </Card>
    </Animated.View>
  );
});

export const SectionTrendContent = React.memo(function SectionTrendContent({
  insight,
}: SectionTrendContentProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  // Memoised so the empty fallback is one array rather than a fresh one each
  // render, which recomputed the cluster context and the rows below it.
  const supportingSections = insight.supportingData?.sections;
  const sections = useMemo(() => supportingSections ?? [], [supportingSections]);
  const context = useMemo(() => getClusterContext(sections, t), [sections, t]);

  // All sections start collapsed
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const handleToggle = useCallback((rowKey: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) {
        next.delete(rowKey);
      } else {
        next.add(rowKey);
      }
      return next;
    });
  }, []);

  const hasAnyPR = useMemo(
    () => sections.some((s: SupportingSection) => s.hasRecentPR),
    [sections]
  );

  if (sections.length === 0) return null;

  return (
    <View style={styles.container}>
      <SheetContext heading={context.heading} meta={context.meta} />

      {sections.map((section: SupportingSection) => (
        <SectionAccordionItem
          key={sectionRowKey(section)}
          section={section}
          expanded={expandedIds.has(sectionRowKey(section))}
          onToggle={handleToggle}
        />
      ))}

      {hasAnyPR ? (
        <Animated.View layout={LinearTransition} style={styles.legend}>
          <Icon
            name="trophy"
            size={iconSize.xs}
            color={isDark ? darkColors.achievement : colors.achievement}
          />
          <Text style={[styles.legendText, isDark && styles.legendTextDark]}>
            {t('insights.recentPersonalRecord')}
          </Text>
        </Animated.View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
  },
  sectionContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginRight: spacing.xs,
  },
  chevronButton: {
    padding: spacing.xs,
  },
  sectionNameRow: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginRight: spacing.sm,
  },
  sportIcon: {
    marginRight: spacing.xs,
  },
  sectionName: {
    ...typography.bodySmallBold,
    flex: 1,
    color: colors.textPrimary,
  },
  sectionNameDark: {
    color: darkColors.textPrimary,
  },
  prChip: {
    backgroundColor: brand.gold,
    borderRadius: layout.borderRadiusSm,
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.xs,
  },
  sectionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  bestTime: {
    ...typography.bodyCompactBold,
    color: colors.textPrimary,
  },
  bestTimeDark: {
    color: darkColors.textPrimary,
  },
  traversals: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  traversalsDark: {
    color: darkColors.textSecondary,
  },
  change: {
    ...typography.captionBold,
    fontVariant: ['tabular-nums'],
  },
  expandedContent: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  shimmerRow: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: layout.borderRadiusSm,
    padding: spacing.xs,
  },
  shimmerRowDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  noEfforts: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
    paddingVertical: spacing.xs,
  },
  noEffortsDark: {
    color: darkColors.textSecondary,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  legendText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  legendTextDark: {
    color: darkColors.textSecondary,
  },
});
