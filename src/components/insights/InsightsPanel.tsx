import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { TodayBanner } from '@/components/routes/TodayBanner';
import { InsightListCard } from './InsightListCard';
import { InsightDetailSheet } from './InsightDetailSheet';
import { PatternDetailSheet } from './PatternDetailSheet';
import { colors, darkColors, spacing, layout } from '@/theme';
import type { Insight } from '@/types';

const DEFAULT_VISIBLE = 5;

interface InsightsPanelProps {
  insights: Insight[];
}

export const InsightsPanel = React.memo(function InsightsPanel({ insights }: InsightsPanelProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const [selectedInsight, setSelectedInsight] = useState<Insight | null>(null);
  const [expanded, setExpanded] = useState(false);

  const visibleInsights = expanded ? insights : insights.slice(0, DEFAULT_VISIBLE);
  const hiddenCount = insights.length - DEFAULT_VISIBLE;

  return (
    <View style={styles.container}>
      <TodayBanner />
      {insights.length > 0 ? (
        <View style={styles.cardList}>
          {visibleInsights.map((insight) => (
            <InsightListCard
              key={insight.id}
              insight={insight}
              onPress={(i) => setSelectedInsight(i)}
            />
          ))}
          {!expanded && hiddenCount > 0 ? (
            <Button
              mode="text"
              onPress={() => setExpanded(true)}
              compact
              style={styles.showMoreButton}
              labelStyle={[styles.showMoreLabel, isDark && styles.showMoreLabelDark]}
            >
              {t('insights.showMore', {
                count: hiddenCount,
                defaultValue: `Show ${hiddenCount} more`,
              })}
            </Button>
          ) : null}
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
      {selectedInsight?.category === 'activity_pattern' ? (
        <PatternDetailSheet
          insight={selectedInsight}
          visible={!!selectedInsight}
          onClose={() => setSelectedInsight(null)}
        />
      ) : (
        <InsightDetailSheet
          insight={selectedInsight}
          visible={!!selectedInsight}
          onClose={() => setSelectedInsight(null)}
        />
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.xs,
  },
  cardList: {
    paddingVertical: spacing.xs,
  },
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
  showMoreButton: {
    alignSelf: 'center',
    marginTop: spacing.xs,
  },
  showMoreLabel: {
    fontSize: 13,
    color: colors.primary,
  },
  showMoreLabelDark: {
    color: darkColors.primary,
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
