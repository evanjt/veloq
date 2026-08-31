import React, { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';

import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing } from '@/theme';

import { getLastInsightOutcome } from '../lib/generateInsights';

interface Props {
  visible: boolean;
  onClose: () => void;
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

  const outcome = useMemo(() => getLastInsightOutcome(), [visible]);

  if (!__DEV__) return null;

  const scoredById = new Map(outcome?.scored.map((s) => [s.insight.id, s]) ?? []);
  const onScreen = outcome?.consolidated ?? outcome?.kept ?? [];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, isDark && styles.containerDark]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: textColor }]}>Insight pipeline debug</Text>
          <Pressable onPress={onClose} style={styles.closeBtn}>
            <Text style={{ color: textColor, fontSize: 15 }}>Close</Text>
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
                const breakdown = scored
                  ? ` (cat=${scored.breakdown.category} spec=${scored.breakdown.specificity} self=${scored.breakdown.temporalSelf} sig=${scored.breakdown.signal})`
                  : '';
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
              {outcome.capDropped.map((d) => (
                <Text key={d.insight.id} style={[styles.row, { color: mutedColor }]}>
                  {`DROPPED  ${d.insight.category}/${d.insight.id} - score=${d.score.toFixed(0)} (${d.reason})`}
                </Text>
              ))}

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
    fontSize: 20,
    fontWeight: '600',
  },
  closeBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  section: {
    fontSize: 16,
    fontWeight: '600',
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  scroll: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl * 2,
  },
  row: {
    fontFamily: 'monospace',
    fontSize: 11,
    paddingVertical: 2,
  },
});
