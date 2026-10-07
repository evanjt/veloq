import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, LayoutAnimation, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useTheme } from '@/shared/app';
import { getActivityIcon } from '@/shared/activity/activityUtils';
import { useSectionPerformances } from '@/features/routes';
import { useSectionDetail } from '@/shared/native/useSectionDetail';
import { Shimmer } from '@/shared/ui/Shimmer';
import { RecentEffortsList } from './RecentEffortsList';
import { formatDuration } from '@/shared/format/format';
import {
  brand,
  colors,
  darkColors,
  spacing,
  shadows,
  opacity,
  ink,
  verdictColor,
  layout,
  typography,
} from '@/theme';
import type { Insight, SupportingSection } from '@/types';
import { pressable, pressRipple, EngineReadFailure } from '@/shared/ui';
import type { TFunc } from '../../types';
import { sectionRowKey, sectionWithSport } from '../../lib/cardSport';

function getTrendIcon(trend?: number): string {
  if (trend == null) return 'minus';
  if (trend > 0) return 'trending-up';
  if (trend < 0) return 'trending-down';
  return 'minus';
}

// A section trend above zero is a faster time, so a decline is the negative
// rung and not the caution one: nothing here is a warning about what comes
// next, it is a judgement on what already happened.
export function getTrendColor(trend: number | undefined, isDark: boolean): string {
  if (trend == null) return verdictColor('neutral', isDark);
  if (trend > 0) return verdictColor('positive', isDark);
  if (trend < 0) return verdictColor('negative', isDark);
  return verdictColor('neutral', isDark);
}

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
 * The row opens the section's efforts in this sheet.
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
  const { section: fullSection, error: sectionError } = useSectionDetail(
    expanded ? section.sectionId : null
  );
  // The trend's sport, which is what the row was ranked under. Read
  // unfiltered, the accordion opened on every sport's efforts.
  const { records, bests, isLoading } = useSectionPerformances(
    expanded ? fullSection : null,
    section.sportType
  );

  const handleToggle = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onToggle(sectionRowKey(section));
  }, [onToggle, section]);

  return (
    <View style={[styles.sectionCard, isDark && styles.sectionCardDark]}>
      <View style={styles.sectionHeader}>
        <Pressable
          onPress={handleToggle}
          style={pressable(styles.sectionContent)}
          android_ripple={pressRipple}
        >
          <View style={styles.sectionNameRow}>
            {section.sportType ? (
              <MaterialCommunityIcons
                name={getActivityIcon(section.sportType)}
                size={14}
                color={isDark ? darkColors.textSecondary : colors.textSecondary}
                style={styles.sportIcon}
              />
            ) : null}
            <Text style={[styles.sectionName, isDark && styles.sectionNameDark]} numberOfLines={1}>
              {sectionWithSport(section.sectionName, section.sportType, t as unknown as TFunc)}
            </Text>
            {section.hasRecentPR ? (
              <View style={styles.prChip}>
                <MaterialCommunityIcons name="trophy" size={10} color={ink.white} />
              </View>
            ) : null}
          </View>
          <View style={styles.sectionMeta}>
            {section.bestTime != null ? (
              <Text style={[styles.bestTime, isDark && styles.bestTimeDark]}>
                {formatDuration(section.bestTime)}
              </Text>
            ) : null}
            {section.traversalCount != null ? (
              <Text style={[styles.traversals, isDark && styles.traversalsDark]}>
                {section.traversalCount}x
              </Text>
            ) : null}
            <MaterialCommunityIcons
              name={getTrendIcon(section.trend) as never}
              size={16}
              color={getTrendColor(section.trend, isDark)}
            />
          </View>
        </Pressable>

        {/* Chevron: tappable to toggle accordion */}
        <Pressable
          onPress={handleToggle}
          testID={`section-trend-toggle-${section.sectionId}`}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 4 }}
          style={pressable(styles.chevronButton)}
          android_ripple={pressRipple}
        >
          <MaterialCommunityIcons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={18}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        </Pressable>
      </View>

      {expanded ? (
        <View style={styles.expandedContent}>
          {sectionError !== undefined ? (
            <EngineReadFailure error={sectionError} testID="section-read-failure" />
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
        </View>
      ) : null}
    </View>
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
      <View style={[styles.contextCard, isDark && styles.contextCardDark]}>
        <Text style={[styles.contextHeading, isDark && styles.contextHeadingDark]}>
          {context.heading}
        </Text>
        <Text style={[styles.contextMeta, isDark && styles.contextMetaDark]}>{context.meta}</Text>
      </View>

      {sections.map((section: SupportingSection) => (
        <SectionAccordionItem
          key={sectionRowKey(section)}
          section={section}
          expanded={expandedIds.has(sectionRowKey(section))}
          onToggle={handleToggle}
        />
      ))}

      {hasAnyPR ? (
        <View style={styles.legend}>
          <MaterialCommunityIcons name="trophy" size={12} color={brand.gold} />
          <Text style={[styles.legendText, isDark && styles.legendTextDark]}>
            {t('insights.recentPersonalRecord')}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    gap: spacing.xs,
  },
  contextCard: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: layout.borderRadiusMd,
    padding: spacing.md,
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  contextCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  contextHeading: {
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  contextHeadingDark: {
    color: darkColors.textPrimary,
  },
  contextMeta: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  contextMetaDark: {
    color: darkColors.textSecondary,
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadiusMd,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadows.card,
  },
  sectionCardDark: {
    backgroundColor: darkColors.surfaceCard,
    borderColor: darkColors.border,
    ...shadows.none,
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
    flex: 1,
    fontSize: typography.bodySmall.fontSize,
    fontWeight: '500',
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
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  bestTimeDark: {
    color: darkColors.textPrimary,
  },
  traversals: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  traversalsDark: {
    color: darkColors.textSecondary,
  },
  chevronButton: {
    padding: spacing.xs,
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
    fontSize: typography.bodyCompact.fontSize,
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
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
  legendTextDark: {
    color: darkColors.textSecondary,
  },
});
