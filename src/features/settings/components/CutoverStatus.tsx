/**
 * Status line for the detector cutover.
 *
 * The re-cut fires unattended at launch and rebuilds the whole catalogue, and
 * until now the only surface that said so was the What's New carousel, which a
 * user who skips it never sees.
 *
 * `CutoverProgress` carries a phase and nothing else, so this is a phase name
 * and a spinner rather than a bar. The section rescan on the same screen does
 * have a real percentage, so the two are kept apart and read differently.
 *
 * It only speaks about a run it watched start. A screen opened after the
 * cutover is over shows nothing, because a phase left over from a run the user
 * never saw is noise, not news.
 */

import React, { useCallback, useState } from 'react';
import { View, ActivityIndicator, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { getEngine } from '@/shared/native/engine';
import { useCutoverSummary } from '@/features/routes';
import { CUTOVER_FAILURE_KEYS, CUTOVER_PHASE_KEYS } from '../lib/cutoverPhaseKeys';
import { colors, darkColors, spacing, typography } from '@/theme';
import { pressable, pressRipple } from '@/shared/ui';

export const CUTOVER_STATUS_TEST_ID = 'cutover-status';
export const CUTOVER_CANCEL_TEST_ID = 'cutover-cancel';

export function CutoverStatus() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { phase, isRunning, sawRun } = useCutoverSummary();
  const [stopping, setStopping] = useState(false);
  const [stoppingBelongsTo, setStoppingBelongsTo] = useState(isRunning);

  // The offer belongs to the run it stops. A later run is a new run and gets
  // its own, which is also the engine's rule: the flag is cleared when a run
  // claims the slot. Adjusted during render rather than in an effect, so the
  // stale offer never reaches a frame.
  if (stoppingBelongsTo !== isRunning) {
    setStoppingBelongsTo(isRunning);
    if (!isRunning) setStopping(false);
  }

  const stop = useCallback(() => {
    setStopping(true);
    getEngine()?.cancelDetectorCutover?.();
  }, []);

  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const danger = isDark ? darkColors.error : colors.error;

  if (isRunning) {
    const phaseKey = CUTOVER_PHASE_KEYS[phase as keyof typeof CUTOVER_PHASE_KEYS];
    if (!phaseKey) return null;
    return (
      <View style={styles.block} testID={CUTOVER_STATUS_TEST_ID}>
        <View style={styles.row}>
          <ActivityIndicator size="small" color={textSecondary} />
          <Text style={[styles.line, { color: textSecondary }]}>
            {t('settings.cutoverRebuilding', { phase: t(phaseKey) })}
          </Text>
        </View>
        {stopping ? (
          // The run stops at its next step boundary, not on the tap, and the
          // migration is still owed either way. Saying so is the difference
          // between a pause and a promise this cannot keep.
          <Text style={[styles.line, styles.centred, { color: textSecondary }]}>
            {t('settings.cutoverStopping')}
          </Text>
        ) : (
          <Pressable
            onPress={stop}
            testID={CUTOVER_CANCEL_TEST_ID}
            accessibilityRole="button"
            hitSlop={8}
            style={pressable()}
            android_ripple={pressRipple}
          >
            <Text style={[styles.line, styles.centred, styles.stop, { color: textSecondary }]}>
              {t('settings.cutoverStop')}
            </Text>
          </Pressable>
        )}
      </View>
    );
  }

  const failure = CUTOVER_FAILURE_KEYS[phase as keyof typeof CUTOVER_FAILURE_KEYS];
  if (sawRun && failure) {
    return (
      <Text
        style={[styles.line, styles.centred, { color: danger }]}
        testID={CUTOVER_STATUS_TEST_ID}
      >
        {t(failure.status)}
      </Text>
    );
  }

  return null;
}

const styles = StyleSheet.create({
  block: {
    marginTop: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  stop: {
    textDecorationLine: 'underline',
  },
  line: {
    ...typography.bodySmall,
  },
  centred: {
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
