/**
 * Status line for the detector cutover.
 *
 * The re-cut fires unattended at launch and rebuilds the whole catalogue, and
 * until now the only surface that said so was the What's New carousel, which a
 * user who skips it never sees (`B134`, decided in `Q29`).
 *
 * `CutoverProgress` carries a phase and nothing else, so this is a phase name
 * and a spinner rather than a bar. The section rescan on the same screen does
 * have a real percentage, so the two are kept apart and read differently.
 *
 * It only speaks about a run it watched start. A screen opened after the
 * cutover is over shows nothing, because a phase left over from a run the user
 * never saw is noise, not news.
 */

import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useCutoverSummary } from '@/features/routes/hooks/useCutoverSummary';
import type { CutoverPhase } from 'veloqrs';
import { colors, darkColors, spacing, typography } from '@/theme';

export const CUTOVER_STATUS_TEST_ID = 'cutover-status';

const PHASE_KEYS = {
  draining: 'settings.cutoverPhaseDraining',
  archiving: 'settings.cutoverPhaseArchiving',
  detecting: 'settings.cutoverPhaseDetecting',
  diffing: 'settings.cutoverPhaseDiffing',
} as const satisfies Partial<Record<CutoverPhase, string>>;

export function CutoverStatus() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { phase, isRunning, sawRun } = useCutoverSummary();

  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const danger = isDark ? darkColors.error : colors.error;

  if (isRunning) {
    const phaseKey = PHASE_KEYS[phase as keyof typeof PHASE_KEYS];
    if (!phaseKey) return null;
    return (
      <View style={styles.row} testID={CUTOVER_STATUS_TEST_ID}>
        <ActivityIndicator size="small" color={textSecondary} />
        <Text style={[styles.line, { color: textSecondary }]}>
          {t('settings.cutoverRebuilding', { phase: t(phaseKey) })}
        </Text>
      </View>
    );
  }

  if (sawRun && phase === 'failed') {
    return (
      <Text
        style={[styles.line, styles.centred, { color: danger }]}
        testID={CUTOVER_STATUS_TEST_ID}
      >
        {t('settings.cutoverFailed')}
      </Text>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  line: {
    ...typography.bodySmall,
  },
  centred: {
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
