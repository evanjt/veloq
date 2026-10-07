import React, { useState, useCallback, useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { TodayBanner } from '@/features/routes';
import { InsightListCard } from './InsightListCard';
import { InsightDetailSheet } from './InsightDetailSheet';
import { InsightDebugPanel } from './InsightDebugPanel';
import { ErrorStatePreset, TAB_BAR_SAFE_PADDING, pressable, pressRipple } from '@/shared/ui';
import { formatRelativeDate } from '@/shared/format/format';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import type { Insight } from '@/types';

interface InsightsPanelProps {
  insights: Insight[];
  /** The pipeline threw, so the empty list says so instead of the empty-library hint. */
  failed?: boolean | undefined;
  /** Reads the insights again; offered beside the failure message. */
  onRetry?: (() => void) | undefined;
  /**
   * The date of the last wellness sync, set only when the form cards were
   * dropped because the window has no row. One quiet line says so rather
   * than letting the cards vanish unexplained.
   */
  hrvWithheldSince?: string | null | undefined;
  /** The newest form reading from the same bundle, null when there is no wellness */
  form?: { ctl: number; atl: number } | null | undefined;
  /**
   * If set, opens the matching insight's detail sheet on mount. Set by a tapped
   * insight notification (`/(tabs)/insights?insightId=...`). Calls
   * `onInsightOpened` once the sheet has been triggered so the parent can clear
   * the URL param.
   */
  initialInsightId?: string | undefined;
  onInsightOpened?: (() => void) | undefined;
}

export const InsightsPanel = React.memo(function InsightsPanel({
  insights,
  failed,
  onRetry,
  hrvWithheldSince,
  form = null,
  initialInsightId,
  onInsightOpened,
}: InsightsPanelProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const [selectedInsight, setSelectedInsight] = useState<Insight | null>(null);
  const [debugOpen, setDebugOpen] = useState(false);
  const handleInsightPress = useCallback((i: Insight) => setSelectedInsight(i), []);
  const handleCloseSheet = useCallback(() => setSelectedInsight(null), []);
  const handleLongPress = useCallback(() => {
    if (__DEV__) setDebugOpen(true);
  }, []);

  // Open the deep-linked insight once it appears in the list.
  useEffect(() => {
    if (!initialInsightId) return;
    const match = insights.find((i) => i.id === initialInsightId);
    if (match) {
      setSelectedInsight(match);
      onInsightOpened?.();
    }
  }, [initialInsightId, insights, onInsightOpened]);

  return (
    <View style={styles.container} testID="insights-panel">
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {__DEV__ ? (
          <Pressable
            onLongPress={handleLongPress}
            delayLongPress={800}
            style={pressable()}
            android_ripple={pressRipple}
          >
            <TodayBanner form={form} />
          </Pressable>
        ) : (
          <TodayBanner form={form} />
        )}
        {insights.length > 0 ? (
          <View style={styles.cardList} testID="insights-card-list">
            {insights.map((insight) => (
              <InsightListCard key={insight.id} insight={insight} onPress={handleInsightPress} />
            ))}
          </View>
        ) : failed ? (
          <View testID="insights-failed">
            <ErrorStatePreset
              message={t('insights.couldNotBuild', 'Insights could not be built')}
              {...(onRetry ? { onRetry } : {})}
            />
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
        {hrvWithheldSince ? (
          <Text
            style={[styles.staleWellness, isDark && styles.emptyDark]}
            testID="insights-stale-wellness"
          >
            {t('insights.wellnessFromLastSync', {
              date: formatRelativeDate(hrvWithheldSince),
            })}
          </Text>
        ) : null}
      </ScrollView>
      <InsightDetailSheet
        insight={selectedInsight}
        visible={!!selectedInsight}
        onClose={handleCloseSheet}
      />
      <InsightDebugPanel visible={debugOpen} onClose={() => setDebugOpen(false)} />
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
    paddingHorizontal: spacing.md,
    gap: spacing.xxs,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    gap: spacing.sm,
  },
  empty: {
    fontSize: typography.bodyCompact.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  emptyHint: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  emptyDark: {
    color: darkColors.textSecondary,
  },
  staleWellness: {
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
});
