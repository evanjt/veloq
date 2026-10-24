/**
 * The change card: this athlete's own cutover to the new section detector.
 * While the re-cut runs it says so in one line. Once it settles it reports the stored diff, so the
 * numbers are the engine's rather than a promise. A failed run says so and
 * withholds the diff, which still describes the run before it.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import {
  CUTOVER_FAILURE_KEYS,
  getPhaseDisplayKey,
  useCutoverSummary,
  useRetiredSectionCount,
} from '@/features/routes';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';
import type { CutoverCounts, CutoverSettings, CutoverSettingsReset } from 'veloqrs';
import { Button } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { navigateTo } from '@/shared/app/navigation';

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

/** The stored diff in one line: the totals and the breakdown, or that nothing moved. */
export function describeCutoverCounts(counts: CutoverCounts, t: Translate): string {
  if (counts.changed + counts.new + counts.gone === 0) {
    return t('whatsNew.v040.diffUnchanged', { count: counts.unchanged });
  }
  // The detector kept none of the library. The totals alone read as a deletion, so say that it kept none.
  if (counts.proposed === 0 && counts.current > 0) {
    return t('whatsNew.v040.diffNoneKept', { count: counts.gone });
  }
  return t('common.sentencePair', {
    first: t('whatsNew.v040.diffTotals', { current: counts.current, proposed: counts.proposed }),
    second: t('whatsNew.v040.diffBreakdown', {
      new: counts.new,
      changed: counts.changed,
      gone: counts.gone,
    }),
  });
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
  const retiredCount = useRetiredSectionCount();
  const phaseKey = getPhaseDisplayKey(phase);
  // A failed run leaves the stored diff as the previous run's, so reporting it
  // would dress a failure up as a settled result.
  const failure = isRunning
    ? undefined
    : CUTOVER_FAILURE_KEYS[phase as keyof typeof CUTOVER_FAILURE_KEYS];
  const shown = failure ? null : counts;
  const reset = shown !== null ? settingsReset : null;
  const changes = reset ? describeSettingsReset(reset, t as Translate) : '';
  return (
    <View style={styles.container} testID="change-card">
      {isRunning ? (
        <Text style={[styles.summary, isDark && styles.textDark]} testID="change-card-progress">
          {phaseKey
            ? t('whatsNew.v040.recutRunningPhase', {
                phase: t(phaseKey as never),
              })
            : t('whatsNew.v040.recutRunning')}
        </Text>
      ) : null}
      {failure ? (
        <View style={styles.row} testID="change-card-failed">
          <Icon
            name="alert-circle-outline"
            size={iconSize.md}
            color={isDark ? darkColors.errorText : colors.errorText}
          />
          <Text style={[styles.text, isDark && styles.textDark]}>{t(failure.card)}</Text>
        </View>
      ) : null}
      {shown !== null && (
        <Text style={[styles.summary, isDark && styles.textDark]} testID="change-card-counts">
          {describeCutoverCounts(shown, t as Translate)}
        </Text>
      )}
      {retiredCount > 0 && (
        <Button
          testID="change-card-retired-link"
          variant="secondary"
          size="sm"
          icon="history"
          label={t('sectionHistory.seeRetired')}
          onPress={() => navigateTo('/section-retired')}
        />
      )}
      {changes !== '' && (
        <View style={styles.row} testID="change-card-settings-reset">
          <Icon
            name="tune-variant"
            size={iconSize.md}
            color={isDark ? darkColors.actionPrimary : colors.actionPrimary}
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
