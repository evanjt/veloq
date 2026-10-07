/**
 * The change card: this athlete's own cutover to the new section detector.
 * While the re-cut runs it says so in one line. Once it settles it reports the stored diff, so the
 * numbers are the engine's rather than a promise. A failed run says so and
 * withholds the diff, which still describes the run before it.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { useCutoverSummary } from '@/features/routes';
import { CUTOVER_FAILURE_KEYS, CUTOVER_PHASE_KEYS } from '../../lib/cutoverPhaseKeys';
import { colors, darkColors, spacing, typography } from '@/theme';
import type { CutoverSettings, CutoverSettingsReset } from 'veloqrs';

type Translate = (key: string, vars?: Record<string, unknown>) => string;

const SETTING_LABELS: Record<keyof CutoverSettings, string> = {
  proximityThreshold: 'whatsNew.v040.settingsResetProximity',
  minSectionLength: 'whatsNew.v040.settingsResetMinLength',
  maxSectionLength: 'whatsNew.v040.settingsResetMaxLength',
  minActivities: 'whatsNew.v040.settingsResetMinActivities',
  divergenceThreshold: 'whatsNew.v040.settingsResetDivergence',
};

function settingValue(field: keyof CutoverSettings, value: number): string {
  if (field === 'minActivities') return String(value);
  if (field === 'divergenceThreshold') return `${Math.round(value * 100)}%`;
  return `${Math.round(value)} m`;
}

/** One clause per value the flip moved, so an untouched slider is not named. */
export function describeSettingsReset(reset: CutoverSettingsReset, t: Translate): string {
  const fields = Object.keys(SETTING_LABELS) as (keyof CutoverSettings)[];
  return fields
    .filter((field) => reset.previous[field] !== reset.current[field])
    .map((field) =>
      t('whatsNew.v040.settingsResetChange', {
        label: t(SETTING_LABELS[field]),
        from: settingValue(field, reset.previous[field]),
        to: settingValue(field, reset.current[field]),
      })
    )
    .join(', ');
}

export function SectionChangeCardSlide() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { phase, isRunning, counts, settingsReset } = useCutoverSummary();
  const phaseKey = CUTOVER_PHASE_KEYS[phase as keyof typeof CUTOVER_PHASE_KEYS];
  // A failed run leaves the stored diff as the previous run's, so reporting it
  // would dress a failure up as a settled result.
  const failure = isRunning
    ? undefined
    : CUTOVER_FAILURE_KEYS[phase as keyof typeof CUTOVER_FAILURE_KEYS];
  const shown = failure ? null : counts;
  const untouched = shown !== null && shown.changed + shown.new + shown.gone === 0;
  const reset = shown !== null ? settingsReset : null;
  const changes = reset ? describeSettingsReset(reset, t as Translate) : '';
  return (
    <View style={styles.container} testID="change-card">
      {isRunning && (
        <Text style={[styles.summary, isDark && styles.textDark]} testID="change-card-progress">
          {phaseKey
            ? t('whatsNew.v040.recutRunningPhase', {
                phase: t(phaseKey as never),
              })
            : t('whatsNew.v040.recutRunning')}
        </Text>
      )}
      {failure && (
        <View style={styles.row} testID="change-card-failed">
          <MaterialCommunityIcons
            name="alert-circle-outline"
            size={18}
            color={isDark ? darkColors.error : colors.error}
          />
          <Text style={[styles.text, isDark && styles.textDark]}>{t(failure.card)}</Text>
        </View>
      )}
      {shown !== null && (
        <Text style={[styles.summary, isDark && styles.textDark]} testID="change-card-counts">
          {untouched
            ? t('whatsNew.v040.diffUnchanged', { sections: shown.unchanged })
            : `${t('whatsNew.v040.diffTotals', {
                current: shown.current,
                proposed: shown.proposed,
              })} ${t('whatsNew.v040.diffBreakdown', {
                new: shown.new,
                changed: shown.changed,
                gone: shown.gone,
              })}`}
        </Text>
      )}
      {changes !== '' && (
        <View style={styles.row} testID="change-card-settings-reset">
          <MaterialCommunityIcons
            name="tune-variant"
            size={18}
            color={isDark ? darkColors.primary : colors.primary}
          />
          <Text style={[styles.text, isDark && styles.textDark]}>
            {t('whatsNew.v040.settingsReset', { changes })}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    alignSelf: 'stretch',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  summary: { ...typography.bodySmall, color: colors.textPrimary },
  text: { ...typography.bodySmall, color: colors.textPrimary, flex: 1 },
  textDark: { color: darkColors.textPrimary },
});
