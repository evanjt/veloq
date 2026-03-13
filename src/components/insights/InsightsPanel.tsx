import React, { useState } from 'react';
import { StyleSheet, ScrollView, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { TodayBanner } from '@/components/routes/TodayBanner';
import { InsightCard } from './InsightCard';
import { InsightDetailSheet } from './InsightDetailSheet';
import { PatternDetailSheet } from './PatternDetailSheet';
import { colors, darkColors, spacing, layout } from '@/theme';
import type { Insight } from '@/types';

interface InsightsPanelProps {
  insights: Insight[];
}

export const InsightsPanel = React.memo(function InsightsPanel({ insights }: InsightsPanelProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const [selectedInsight, setSelectedInsight] = useState<Insight | null>(null);

  return (
    <View style={styles.container}>
      <TodayBanner />
      {insights.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
          style={styles.scroll}
        >
          {insights.map((insight) => (
            <InsightCard
              key={insight.id}
              insight={insight}
              onPress={(i) => setSelectedInsight(i)}
            />
          ))}
        </ScrollView>
      ) : (
        <Text style={[styles.empty, isDark && styles.emptyDark]}>
          {t('insights.noInsights', 'No insights yet')}
        </Text>
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
  scroll: {
    flexGrow: 0,
  },
  scrollContent: {
    paddingHorizontal: layout.screenPadding,
    paddingVertical: spacing.xs,
  },
  empty: {
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.sm,
  },
  emptyDark: {
    color: darkColors.textSecondary,
  },
});
