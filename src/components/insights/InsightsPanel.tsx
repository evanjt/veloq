import React, { useState, useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { TodayBanner } from '@/components/routes/TodayBanner';
import { InsightListCard } from './InsightListCard';
import { InsightDetailSheet } from './InsightDetailSheet';
import { TAB_BAR_SAFE_PADDING } from '@/components/ui';
import { colors, darkColors, spacing, layout } from '@/theme';
import type { Insight } from '@/types';

interface InsightsPanelProps {
  insights: Insight[];
}

export const InsightsPanel = React.memo(function InsightsPanel({ insights }: InsightsPanelProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const [selectedInsight, setSelectedInsight] = useState<Insight | null>(null);
  const handleInsightPress = useCallback((i: Insight) => setSelectedInsight(i), []);
  const handleCloseSheet = useCallback(() => setSelectedInsight(null), []);

  return (
    <View style={styles.container} testID="insights-panel">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        <TodayBanner />
        {insights.length > 0 ? (
          <View style={styles.cardList} testID="insights-card-list">
            {insights.map((insight) => (
              <InsightListCard key={insight.id} insight={insight} onPress={handleInsightPress} />
            ))}
          </View>
        ) : (
          <View style={styles.emptyContainer} testID="insights-empty">
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
      <InsightDetailSheet
        insight={selectedInsight}
        visible={!!selectedInsight}
        onClose={handleCloseSheet}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  scrollContent: {
    paddingBottom: layout.screenPadding + TAB_BAR_SAFE_PADDING,
  },
  cardList: {
    paddingTop: spacing.sm,
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
});
