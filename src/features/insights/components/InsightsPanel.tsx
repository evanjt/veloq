import React, { useState, useCallback, useEffect } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { useSheetOpener } from '@/shared/app/sheetRequest';
import { TodayBanner } from '@/features/routes';
import { InsightListCard } from './InsightListCard';
import { InsightDebugPanel } from './InsightDebugPanel';
import {
  EmptyState,
  ErrorState,
  ExplanationCard,
  pressable,
  pressRipple,
  useScrollEndInset,
} from '@/shared/ui';
import { formatRelativeDate } from '@/shared/format/format';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import type { Insight } from '@/types';
import { CONFIRM_HOLD_MS } from '@/shared/ui/holdDurations';
import { insightsExplanation } from '../lib/aboutCopy';

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
  const scrollEndInset = useScrollEndInset();
  const { t } = useTranslation();
  const [debugOpen, setDebugOpen] = useState(false);
  const openSheet = useSheetOpener();
  const handleInsightPress = useCallback(
    (insight: Insight) => {
      void openSheet<Insight, never>('sheets/insight', insight);
    },
    [openSheet]
  );
  const handleLongPress = useCallback(() => {
    if (__DEV__) setDebugOpen(true);
  }, []);

  // Open the deep-linked insight once it appears in the list.
  useEffect(() => {
    if (!initialInsightId) return;
    const match = insights.find((i) => i.id === initialInsightId);
    if (match) {
      handleInsightPress(match);
      onInsightOpened?.();
    }
  }, [initialInsightId, insights, onInsightOpened, handleInsightPress]);

  return (
    <View style={styles.container} testID="insights-panel">
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: layout.screenPadding + scrollEndInset }}
      >
        {__DEV__ ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('insights.title')}
            onLongPress={handleLongPress}
            delayLongPress={CONFIRM_HOLD_MS}
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
        ) : failed && onRetry ? (
          <View testID="insights-failed">
            <ErrorState error={undefined} fallbackKey="insights.couldNotBuild" onRetry={onRetry} />
          </View>
        ) : (
          <EmptyState
            variant="compact"
            testID="insights-empty"
            icon="lightbulb-outline"
            title={t('insights.noInsights')}
            description={t('insights.noInsightsHint')}
          />
        )}
        {hrvWithheldSince ? (
          <Text
            style={[styles.staleWellness, isDark && styles.secondaryDark]}
            testID="insights-stale-wellness"
          >
            {t('insights.wellnessFromLastSync', {
              date: formatRelativeDate(hrvWithheldSince),
            })}
          </Text>
        ) : null}
        <View style={styles.explanation} testID="insights-explanation">
          <ExplanationCard {...insightsExplanation(t)} />
        </View>
      </ScrollView>
      <InsightDebugPanel visible={debugOpen} onClose={() => setDebugOpen(false)} />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  explanation: {
    paddingTop: spacing.md,
    paddingHorizontal: spacing.md,
  },
  cardList: {
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.md,
    gap: spacing.xxs,
  },
  secondaryDark: {
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
