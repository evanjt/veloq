import React, { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { getLastInsightOutcome } from '@/hooks/insights/generateInsights';
import { colors, darkColors, spacing } from '@/theme';
import { useTheme } from '@/hooks';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/**
 * Dev-only panel showing the last insight pipeline outcome: every candidate,
 * its gate result or score, and why it was dropped. Gated by __DEV__; no
 * production impact. Closes the "dev tooling" ask in the insights-curation
 * bug ticket.
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

  const capDroppedIds = new Set(outcome?.capDropped.map((d) => d.insight.id) ?? []);

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
                Kept ({outcome.kept.length})
              </Text>
              {outcome.scored
                .filter((s) => !capDroppedIds.has(s.insight.id))
                .sort((a, b) => b.score - a.score)
                .map((s) => (
                  <Text key={s.insight.id} style={[styles.row, { color: textColor }]}>
                    {`KEPT  ${s.insight.category}/${s.insight.id} — score=${s.score.toFixed(0)} (cat=${s.breakdown.category} spec=${s.breakdown.specificity} self=${s.breakdown.temporalSelf} sig=${s.breakdown.signal})`}
                  </Text>
                ))}

              <Text style={[styles.section, { color: textColor }]}>
                Cap-dropped ({outcome.capDropped.length})
              </Text>
              {outcome.capDropped.map((d) => (
                <Text key={d.insight.id} style={[styles.row, { color: mutedColor }]}>
                  {`DROPPED  ${d.insight.category}/${d.insight.id} — score=${d.score.toFixed(0)} (${d.reason})`}
                </Text>
              ))}

              <Text style={[styles.section, { color: textColor }]}>
                Gated ({outcome.rejected.length})
              </Text>
              {outcome.rejected.map((r) => (
                <Text key={r.insight.id} style={[styles.row, { color: mutedColor }]}>
                  {`GATED  ${r.insight.category}/${r.insight.id} — ${r.reason}`}
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
