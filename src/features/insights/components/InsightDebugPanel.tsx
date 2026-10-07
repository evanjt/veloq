import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing, typography } from '@/theme';

import { getLastInsightOutcome } from '../lib/generateInsights';
import { pressable, pressRipple } from '@/shared/ui';

interface Props {
  visible: boolean;
  onClose: () => void;
}

type Breakdown = NonNullable<
  ReturnType<typeof getLastInsightOutcome>
>['scored'][number]['breakdown'];

// base leads because the priority step is the largest term in the score.
function formatBreakdown(b: Breakdown): string {
  return `(base=${b.base.toFixed(0)} conf=${b.confidence.toFixed(0)} rank=${b.ranking.toFixed(0)} cat=${b.category} spec=${b.specificity} self=${b.temporalSelf} sig=${b.signal})`;
}

/**
 * Dev-only panel showing the last insight pipeline outcome: what the screen
 * ends up rendering, every candidate that did not get there, and why. Gated by
 * __DEV__; no production impact.
 *
 * The on-screen list is the consolidated one. The pipeline's own `kept` is one
 * stage short: consolidation drops on the section story cap and the
 * duplicate-section rule after it, and reorders what is left.
 */
export const InsightDebugPanel = React.memo(function InsightDebugPanel({
  visible,
  onClose,
}: Props) {
  const { isDark } = useTheme();
  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const mutedColor = isDark ? darkColors.textMuted : colors.textSecondary;

  // A module-level getter, so reading it each render costs nothing, and the
  // render that opens the panel is the one that picks up the latest run.
  const outcome = getLastInsightOutcome();

  if (!__DEV__) return null;

  const scoredById = new Map(outcome?.scored.map((s) => [s.insight.id, s]) ?? []);
  const onScreen = outcome?.consolidated ?? outcome?.kept ?? [];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, isDark && styles.containerDark]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: textColor }]}>Insight pipeline debug</Text>
          <Pressable
            onPress={onClose}
            style={pressable(styles.closeBtn)}
            android_ripple={pressRipple}
          >
            <Text style={{ color: textColor, fontSize: typography.bodyMedium.fontSize }}>
              Close
            </Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.scroll}>
          {!outcome ? (
            <Text style={{ color: mutedColor }}>No pipeline outcome captured yet.</Text>
          ) : (
            <>
              <Text style={[styles.section, { color: textColor }]}>
                {outcome.consolidated
                  ? `On screen (${onScreen.length})`
                  : `Kept, before consolidation (${onScreen.length})`}
              </Text>
              {onScreen.map((insight, index) => {
                const scored = scoredById.get(insight.id);
                const breakdown = scored ? ` ${formatBreakdown(scored.breakdown)}` : '';
                return (
                  <Text
                    key={insight.id}
                    testID="insight-debug-onscreen"
                    style={[styles.row, { color: textColor }]}
                  >
                    {`${index + 1}. ${insight.category}/${insight.id} - score=${scored?.score.toFixed(0) ?? '-'}${breakdown}`}
                  </Text>
                );
              })}

              <Text style={[styles.section, { color: textColor }]}>
                Consolidated out ({outcome.consolidationDropped.length})
              </Text>
              {outcome.consolidationDropped.map((d) => (
                <Text
                  key={d.insight.id}
                  testID="insight-debug-consolidated-out"
                  style={[styles.row, { color: mutedColor }]}
                >
                  {`CONSOLIDATED OUT  ${d.insight.category}/${d.insight.id} - ${d.reason}`}
                </Text>
              ))}

              <Text style={[styles.section, { color: textColor }]}>
                Cap-dropped ({outcome.capDropped.length})
              </Text>
              {outcome.capDropped.map((d) => {
                const scored = scoredById.get(d.insight.id);
                const breakdown = scored ? ` ${formatBreakdown(scored.breakdown)}` : '';
                return (
                  <Text key={d.insight.id} style={[styles.row, { color: mutedColor }]}>
                    {`DROPPED  ${d.insight.category}/${d.insight.id} - score=${d.score.toFixed(0)} (${d.reason})${breakdown}`}
                  </Text>
                );
              })}

              <Text style={[styles.section, { color: textColor }]}>
                Gated ({outcome.rejected.length})
              </Text>
              {outcome.rejected.map((r) => (
                <Text key={r.insight.id} style={[styles.row, { color: mutedColor }]}>
                  {`GATED  ${r.insight.category}/${r.insight.id} - ${r.reason}`}
                </Text>
              ))}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
});

const DEBUG_SCROLL_BOTTOM_PADDING = spacing.xl * 2;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingTop: spacing.xl,
  },
  containerDark: {
    backgroundColor: darkColors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  title: {
    fontSize: typography.statsValue.fontSize,
    fontWeight: '600',
  },
  closeBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  section: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingBottom: DEBUG_SCROLL_BOTTOM_PADDING,
  },
  row: {
    fontFamily: 'monospace',
    fontSize: typography.label.fontSize,
    paddingVertical: spacing.xxs,
  },
});
