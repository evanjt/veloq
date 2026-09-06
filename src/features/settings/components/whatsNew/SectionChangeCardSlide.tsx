/**
 * The change card: what the new section detector delivers, one row per
 * claim, and a row only when this build can back it. Rows read the engine's
 * support flags, so a claim never appears ahead of its feature.
 *
 * Above the claims sits this user's own cutover. While the re-cut runs the
 * card names the phase, and once it settles it reports the stored diff, so
 * the numbers are the engine's rather than a promise. A failed run says so and
 * withholds the diff, which still describes the run before it.
 *
 * The elevation line is the tour's only word on the one-time download that
 * precedes the re-cut, so it sits above the claims on every render.
 */

import React, { useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { getEngine } from '@/shared/native/engine';
import { useEngineSubscription } from '@/shared/native/useEngineSubscription';
import { useCutoverSummary } from '@/features/routes/hooks/useCutoverSummary';
import { colors, darkColors, spacing, typography } from '@/theme';
import type {
  CutoverPhase,
  CutoverSettings,
  CutoverSettingsReset,
  FfiChangeCardSupport as ChangeCardSupport,
} from 'veloqrs';

type Flag = keyof ChangeCardSupport & string;

const ROWS: { flag: Flag; icon: string; key: string }[] = [
  {
    flag: 'deterministic',
    icon: 'check-decagram-outline',
    key: 'whatsNew.v040.rowDeterministic',
  },
  {
    flag: 'sameResultDripOrBatch',
    icon: 'sync',
    key: 'whatsNew.v040.rowSameResult',
  },
  { flag: 'ledger', icon: 'history', key: 'whatsNew.v040.rowLedger' },
  { flag: 'revert', icon: 'undo-variant', key: 'whatsNew.v040.rowRevert' },
  { flag: 'retired', icon: 'archive-outline', key: 'whatsNew.v040.rowRetired' },
  { flag: 'pinnedSurvive', icon: 'pin', key: 'whatsNew.v040.rowPinned' },
  {
    flag: 'sameOnEveryDevice',
    icon: 'devices',
    key: 'whatsNew.v040.rowEveryDevice',
  },
];

/** Draining and archiving are bookkeeping, so they read as one line. */
const PHASE_KEYS: Partial<Record<CutoverPhase, string>> = {
  draining: 'whatsNew.v040.phasePreparing',
  archiving: 'whatsNew.v040.phasePreparing',
  detecting: 'whatsNew.v040.phaseDetecting',
  diffing: 'whatsNew.v040.phaseDiffing',
};

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

export function readChangeCardSupport(): ChangeCardSupport | null {
  try {
    return getEngine()?.getChangeCardSupport() ?? null;
  } catch {
    return null;
  }
}

export function SectionChangeCardSlide() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  // Keyed, not empty. The answer turns on the catalogue's detection method, so
  // it changes at the cutover, and the slide can mount before the root layout
  // has opened the engine at all. An empty deps list left `support` null for
  // the life of the carousel and the slide drawing nothing.
  const trigger = useEngineSubscription(['sections']);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const support = useMemo(() => readChangeCardSupport(), [trigger]);
  const { phase, isRunning, counts, settingsReset } = useCutoverSummary();
  const rows = support ? ROWS.filter((r) => support[r.flag]) : [];
  if (rows.length === 0) return null;
  const phaseKey = PHASE_KEYS[phase];
  // A failed run leaves the stored diff as the previous run's, so reporting it
  // would dress a failure up as a settled result.
  const failed = !isRunning && phase === 'failed';
  const shown = failed ? null : counts;
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
      {failed && (
        <View style={styles.row} testID="change-card-failed">
          <MaterialCommunityIcons
            name="alert-circle-outline"
            size={18}
            color={isDark ? darkColors.error : colors.error}
          />
          <Text style={[styles.text, isDark && styles.textDark]}>
            {t('whatsNew.v040.recutFailed')}
          </Text>
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
      <View style={styles.row} testID="change-card-elevation">
        <MaterialCommunityIcons
          name="elevation-rise"
          size={18}
          color={isDark ? darkColors.primary : colors.primary}
        />
        <Text style={[styles.text, isDark && styles.textDark]}>
          {t('whatsNew.v040.elevationLine')}
        </Text>
      </View>
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
      {rows.map((r) => (
        <View key={r.flag} style={styles.row} testID={`change-card-row-${r.flag}`}>
          <MaterialCommunityIcons
            name={r.icon as never}
            size={18}
            color={isDark ? darkColors.primary : colors.primary}
          />
          <Text style={[styles.text, isDark && styles.textDark]}>{t(r.key as never)}</Text>
        </View>
      ))}
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
