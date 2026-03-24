import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { TodayBanner } from '@/components/routes/TodayBanner';
import { InsightDetailContent } from './content/InsightDetailContent';
import { InsightDetailSheet } from './InsightDetailSheet';
import { PatternDetailSheet } from './PatternDetailSheet';
import { MethodologySection } from './MethodologySection';
import { colors, darkColors, spacing, layout, colorWithOpacity, shadows } from '@/theme';
import type { Insight } from '@/types';

/**
 * Daily brief layout: insights rendered inline with their charts and data,
 * not hidden behind card taps. Each insight is a titled section in a
 * continuous scroll. Tapping the header opens the full detail sheet for
 * deeper drill-down.
 */

/** Categories to skip in the inline brief (shown only in Today banner or filtered out) */
const SKIP_INLINE = new Set(['activity_pattern']);

/** Categories that benefit from a detail sheet drill-down */
const HAS_DETAIL = new Set([
  'section_pr',
  'tsb_form',
  'fitness_milestone',
  'hrv_trend',
  'period_comparison',
  'weekly_load',
  'training_consistency',
]);

interface InsightsPanelProps {
  insights: Insight[];
}

export const InsightsPanel = React.memo(function InsightsPanel({ insights }: InsightsPanelProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const [selectedInsight, setSelectedInsight] = useState<Insight | null>(null);

  const inlineInsights = useMemo(
    () => insights.filter((i) => !SKIP_INLINE.has(i.category)),
    [insights]
  );

  const handleClose = useCallback(() => setSelectedInsight(null), []);
  const noop = useCallback(() => {}, []);

  return (
    <View style={styles.container}>
      <ScrollView showsVerticalScrollIndicator={false}>
        <TodayBanner />
        {inlineInsights.length > 0 ? (
          <View style={styles.briefContainer}>
            {inlineInsights.map((insight) => (
              <InlineInsightSection
                key={insight.id}
                insight={insight}
                isDark={isDark}
                onHeaderPress={
                  HAS_DETAIL.has(insight.category) ? () => setSelectedInsight(insight) : undefined
                }
                onClose={noop}
              />
            ))}
            <Text style={[styles.disclaimer, isDark && styles.disclaimerDark]}>
              {t(
                'insights.disclaimer',
                'Training metrics are estimates based on published exercise science. Individual responses vary. Not medical or coaching advice.'
              )}
            </Text>
          </View>
        ) : (
          <View style={styles.emptyContainer}>
            <MaterialCommunityIcons
              name="lightbulb-outline"
              size={32}
              color={isDark ? darkColors.textMuted : colors.textDisabled}
            />
            <Text style={[styles.empty, isDark && styles.emptyDark]}>
              {t('insights.noInsights', 'No insights yet')}
            </Text>
            <Text style={[styles.emptyHint, isDark && styles.emptyDark]}>
              {t(
                'insights.noInsightsHint',
                'Complete a few more activities to unlock personalized insights'
              )}
            </Text>
          </View>
        )}
      </ScrollView>
      {selectedInsight?.category === 'activity_pattern' ? (
        <PatternDetailSheet
          insight={selectedInsight}
          visible={!!selectedInsight}
          onClose={handleClose}
        />
      ) : (
        <InsightDetailSheet
          insight={selectedInsight}
          visible={!!selectedInsight}
          onClose={handleClose}
        />
      )}
    </View>
  );
});

/** A single insight rendered inline with its visualization */
const InlineInsightSection = React.memo(function InlineInsightSection({
  insight,
  isDark,
  onHeaderPress,
  onClose,
}: {
  insight: Insight;
  isDark: boolean;
  onHeaderPress?: () => void;
  onClose: () => void;
}) {
  const HeaderTag = onHeaderPress ? Pressable : View;
  const headerProps = onHeaderPress ? { onPress: onHeaderPress } : {};

  return (
    <View style={[styles.section, isDark && styles.sectionDark]}>
      <HeaderTag {...headerProps} style={styles.sectionHeader}>
        <View
          style={[
            styles.sectionIcon,
            { backgroundColor: colorWithOpacity(insight.iconColor, 0.12) },
          ]}
        >
          <MaterialCommunityIcons
            name={insight.icon as never}
            size={14}
            color={insight.iconColor}
          />
        </View>
        <Text style={[styles.sectionTitle, isDark && styles.sectionTitleDark]} numberOfLines={1}>
          {insight.title}
        </Text>
        {insight.isNew ? <View style={styles.newDot} /> : null}
        {onHeaderPress ? (
          <MaterialCommunityIcons
            name="chevron-right"
            size={16}
            color={isDark ? darkColors.textMuted : colors.textMuted}
          />
        ) : null}
      </HeaderTag>

      {insight.subtitle ? (
        <Text style={[styles.sectionSubtitle, isDark && styles.sectionSubtitleDark]}>
          {insight.subtitle}
        </Text>
      ) : null}

      {insight.body ? (
        <Text style={[styles.sectionBody, isDark && styles.sectionBodyDark]}>{insight.body}</Text>
      ) : null}

      <View style={styles.contentInline}>
        <InsightDetailContent insight={insight} onClose={onClose} />
      </View>

      <MethodologySection insight={insight} />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  briefContainer: {
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  // Inline section card
  section: {
    marginHorizontal: spacing.md,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
    ...shadows.card,
  },
  sectionDark: {
    backgroundColor: darkColors.surfaceCard,
    borderWidth: 1,
    borderColor: darkColors.border,
    ...shadows.none,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.xs,
    gap: spacing.sm,
  },
  sectionIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  sectionTitleDark: {
    color: darkColors.textPrimary,
  },
  newDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FC4C02',
  },
  sectionSubtitle: {
    fontSize: 12,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  sectionSubtitleDark: {
    color: darkColors.textSecondary,
  },
  sectionBody: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  sectionBodyDark: {
    color: darkColors.textSecondary,
  },
  contentInline: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  // Empty state
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  empty: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  emptyDark: {
    color: darkColors.textSecondary,
  },
  disclaimer: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: layout.screenPadding,
    paddingTop: spacing.sm,
    lineHeight: 16,
  },
  disclaimerDark: {
    color: darkColors.textMuted,
  },
});
