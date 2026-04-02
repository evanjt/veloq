import React, { useCallback, useMemo, useState } from 'react';
import { View, StyleSheet, LayoutAnimation, Platform, UIManager, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks';
import { getSportDisplayName } from '@/hooks/insights/sectionClusterInsights';
import { useSectionDetail } from '@/hooks/routes/useRouteEngine';
import { useSectionPerformances } from '@/hooks/routes/useSectionPerformances';
import { navigateTo } from '@/lib';
import { getActivityIcon } from '@/lib/utils/activityUtils';
import { Shimmer } from '@/components/ui/Shimmer';
import { RecentEffortsList } from './RecentEffortsList';
import { formatDuration } from '@/lib';
import { colors, darkColors, spacing, shadows, opacity } from '@/theme';
import type { Insight, SupportingSection } from '@/types';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const PR_GOLD = '#D4AF37';

function getTrendIcon(trend?: number): string {
  if (trend == null) return 'minus';
  if (trend > 0) return 'trending-up';
  if (trend < 0) return 'trending-down';
  return 'minus';
}

function getTrendColor(trend?: number, isDark?: boolean): string {
  if (trend == null) return isDark ? darkColors.textSecondary : colors.textSecondary;
  if (trend > 0) return colors.success;
  if (trend < 0) return colors.warning;
  return isDark ? darkColors.textSecondary : colors.textSecondary;
}

interface SectionTrendContentProps {
  insight: Insight;
}

function capitalize(value: string): string {
  return value.length > 0 ? value[0].toUpperCase() + value.slice(1) : value;
}

function getClusterContext(
  insight: Insight,
  sections: SupportingSection[]
): {
  heading: string;
  body: string;
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
  const sportLabel = uniqueSports.length === 1 ? getSportDisplayName(uniqueSports[0]) : null;
  const direction = insight.id.includes('declining') ? 'declining' : 'improving';

  return {
    heading: sportLabel ? `${capitalize(sportLabel)} section group` : 'Section group',
    body:
      direction === 'declining'
        ? sportLabel
          ? `These ${sportLabel} sections are grouped because their recent efforts are moving in the same direction. Seeing the pattern on multiple sections makes it easier to separate broader drift from one awkward pass.`
          : 'These sections are grouped because their recent efforts are moving in the same direction. Seeing the pattern on multiple sections makes it easier to separate broader drift from one awkward pass.'
        : sportLabel
          ? `These ${sportLabel} sections are grouped because their recent efforts are moving in the same direction. Seeing the pattern on multiple sections makes it easier to trust than a one-off result.`
          : 'These sections are grouped because their recent efforts are moving in the same direction. Seeing the pattern on multiple sections makes it easier to trust than a one-off result.',
    meta: 'Expand a row to inspect the underlying efforts.',
  };
}

/**
 * Expandable accordion item for a single section.
 * Always mounts the hook (no conditional hook calls) but only
 * fetches/renders effort data when expanded.
 *
 * Two tap targets:
 *  - Section name area navigates to section detail page
 *  - Chevron toggles accordion open/closed
 */
const SectionAccordionItem = React.memo(function SectionAccordionItem({
  section,
  expanded,
  onToggle,
}: {
  section: SupportingSection;
  expanded: boolean;
  onToggle: (sectionId: string) => void;
}) {
  const { isDark } = useTheme();
  const { section: fullSection } = useSectionDetail(expanded ? section.sectionId : null);
  const { records, bestRecord, isLoading } = useSectionPerformances(expanded ? fullSection : null);

  const handleToggle = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    onToggle(section.sectionId);
  }, [onToggle, section.sectionId]);

  const handleNavigateToSection = useCallback(() => {
    navigateTo(`/section/${section.sectionId}`);
  }, [section.sectionId]);

  return (
    <View style={[styles.sectionCard, isDark && styles.sectionCardDark]}>
      <View style={styles.sectionHeader}>
        {/* Section name: tappable to navigate to section detail */}
        <Pressable onPress={handleNavigateToSection} style={styles.sectionContent}>
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
              {section.sectionName}
            </Text>
            {section.hasRecentPR ? (
              <View style={styles.prChip}>
                <MaterialCommunityIcons name="trophy" size={10} color="#FFFFFF" />
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
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 4 }}
          style={styles.chevronButton}
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
          {isLoading ? (
            <View style={[styles.shimmerRow, isDark && styles.shimmerRowDark]}>
              <Shimmer width="100%" height={40} borderRadius={8} />
            </View>
          ) : records.length > 0 ? (
            <RecentEffortsList records={records} bestRecord={bestRecord} />
          ) : (
            <Text style={[styles.noEfforts, isDark && styles.noEffortsDark]}>
              No recorded efforts
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
  const sections = insight.supportingData?.sections ?? [];
  const context = useMemo(() => getClusterContext(insight, sections), [insight, sections]);

  // All sections start collapsed
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const handleToggle = useCallback((sectionId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
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
        <Text style={[styles.contextBody, isDark && styles.contextBodyDark]}>{context.body}</Text>
        <Text style={[styles.contextMeta, isDark && styles.contextMetaDark]}>{context.meta}</Text>
      </View>

      {sections.map((section: SupportingSection) => (
        <SectionAccordionItem
          key={section.sectionId}
          section={section}
          expanded={expandedIds.has(section.sectionId)}
          onToggle={handleToggle}
        />
      ))}

      {hasAnyPR ? (
        <View style={styles.legend}>
          <MaterialCommunityIcons name="trophy" size={12} color={PR_GOLD} />
          <Text style={[styles.legendText, isDark && styles.legendTextDark]}>
            Recent personal record
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
    borderRadius: 10,
    padding: spacing.md,
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  contextCardDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  contextHeading: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  contextHeadingDark: {
    color: darkColors.textPrimary,
  },
  contextBody: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textPrimary,
  },
  contextBodyDark: {
    color: darkColors.textPrimary,
  },
  contextMeta: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  contextMetaDark: {
    color: darkColors.textSecondary,
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: 10,
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
    marginRight: 4,
  },
  sectionName: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  sectionNameDark: {
    color: darkColors.textPrimary,
  },
  prChip: {
    backgroundColor: PR_GOLD,
    borderRadius: 8,
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  sectionMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  bestTime: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  bestTimeDark: {
    color: darkColors.textPrimary,
  },
  traversals: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  traversalsDark: {
    color: darkColors.textSecondary,
  },
  chevronButton: {
    padding: 4,
  },
  expandedContent: {
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
    gap: spacing.xs,
  },
  shimmerRow: {
    backgroundColor: opacity.overlay.subtle,
    borderRadius: 8,
    padding: spacing.xs,
  },
  shimmerRowDark: {
    backgroundColor: opacity.overlayDark.light,
  },
  noEfforts: {
    fontSize: 13,
    color: colors.textSecondary,
    paddingVertical: spacing.xs,
  },
  noEffortsDark: {
    color: darkColors.textSecondary,
  },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  legendText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  legendTextDark: {
    color: darkColors.textSecondary,
  },
});
