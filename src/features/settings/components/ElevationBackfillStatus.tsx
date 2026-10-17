/**
 * Status line for the elevation backfill.
 *
 * The backfill starts on its own after an update. The control here is a pause,
 * which ends the run in flight, and a resume, which puts it back to work. The
 * pause used to have no inverse but a force-quit, and detection is held behind
 * this queue, so a paused install had no way back to a working detector.
 * The queue length is only known once a run has started, so the line reports
 * a count rather than a bar, and each terminal state reads distinctly.
 *
 * Nothing else tells the user why the download is happening: the detector flip
 * is held behind the queue draining, and that gate is silent. So the line also
 * says what is waiting on it, with a Why control for the longer answer.
 */

import React from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { elevation } from 'veloqrs';

import { useTheme } from '@/shared/app';
import { useElevationBackfill, useRouteSettings } from '@/features/routes';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';
import { Button } from '@/shared/ui';
import { openExplainer } from '@/shared/app/explainer';

export function ElevationBackfillStatus() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { phase, completed, total, failed, remaining, isPaused } = useElevationBackfill();
  const routeMatchingEnabled = useRouteSettings((state) => state.settings.enabled);

  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const danger = isDark ? darkColors.error : colors.error;

  // The phase is a process-global that starts at `idle`, so at rest it says
  // nothing about the library. The outstanding count is the durable fact:
  // a positive count is work owed, zero is nothing owed, and null is an engine
  // that could not answer, which must not read as a finished backfill.
  const outstandingAtRest = phase === 'idle' && remaining !== null && remaining > 0;
  if (phase === 'idle' && !outstandingAtRest) return null;

  // A pass is either running or armed to run again, so both states can be
  // paused. Once every track has elevation there is nothing left to stop, and
  // a pause already taken offers its inverse rather than itself.
  const pausable = !isPaused && (phase === 'fetching' || phase === 'partial' || outstandingAtRest);

  const status =
    !routeMatchingEnabled && phase !== 'complete' ? (
      <Text
        style={[styles.line, styles.centred, { color: textSecondary }]}
        testID="elevation-backfill-status"
      >
        {t('settings.elevationBackfillSwitchedOff')}
      </Text>
    ) : outstandingAtRest ? (
      <Text
        style={[styles.line, styles.centred, { color: textSecondary }]}
        testID="elevation-backfill-status"
      >
        {t('settings.elevationBackfillOutstanding', { count: remaining ?? 0 })}
      </Text>
    ) : phase === 'fetching' ? (
      <View style={styles.runningRow} testID="elevation-backfill-status">
        <ActivityIndicator size="small" color={textSecondary} />
        <View style={styles.runningText}>
          <Text style={[styles.line, { color: textSecondary }]}>
            {t('settings.elevationBackfillRunning')}
          </Text>
          <Text style={[styles.line, { color: textSecondary }]}>
            {t('settings.elevationBackfillProgress', { completed, total })}
          </Text>
        </View>
      </View>
    ) : phase === 'failed' ? (
      <Text
        style={[styles.line, styles.centred, { color: danger }]}
        testID="elevation-backfill-status"
      >
        {t('settings.elevationBackfillFailed')}
      </Text>
    ) : phase === 'paused' ? (
      <Text
        style={[styles.line, styles.centred, { color: textSecondary }]}
        testID="elevation-backfill-status"
      >
        {t('settings.elevationBackfillPaused')}
      </Text>
    ) : (
      <Text
        style={[styles.line, styles.centred, { color: textSecondary }]}
        testID="elevation-backfill-status"
      >
        {phase === 'complete'
          ? t('settings.elevationBackfillComplete')
          : failed > 0
            ? t('settings.elevationBackfillRetrying', { count: failed })
            : t('settings.elevationBackfillPartial')}
      </Text>
    );

  return (
    <View>
      {status}

      {pausable ? (
        <Button
          testID="elevation-backfill-pause"
          label={t('settings.elevationBackfillPause')}
          onPress={() => elevation.pauseElevationBackfill()}
          variant="ghost"
          size="sm"
          style={styles.action}
          icon={
            <MaterialCommunityIcons
              name="pause-circle-outline"
              size={iconSize.sm}
              color={colors.primary}
            />
          }
        />
      ) : null}

      {isPaused ? (
        <Button
          testID="elevation-backfill-resume"
          label={t('settings.elevationBackfillResume')}
          onPress={() => elevation.resumeElevationBackfill()}
          variant="ghost"
          size="sm"
          style={styles.action}
          icon={
            <MaterialCommunityIcons
              name="play-circle-outline"
              size={iconSize.sm}
              color={colors.primary}
            />
          }
        />
      ) : null}

      {routeMatchingEnabled && phase !== 'complete' && phase !== 'paused' ? (
        <Text
          style={[styles.line, styles.centred, { color: textSecondary }]}
          testID="elevation-backfill-explainer"
        >
          {t('settings.elevationBackfillExplainer')}
        </Text>
      ) : null}

      <Button
        testID="elevation-backfill-why"
        label={t('settings.elevationBackfillWhy')}
        onPress={() =>
          openExplainer({
            title: t('settings.elevationBackfillWhyTitle'),
            body: t('settings.elevationBackfillWhyBody'),
          })
        }
        variant="ghost"
        size="sm"
        style={styles.action}
        icon={
          <MaterialCommunityIcons
            name="information-outline"
            size={iconSize.sm}
            color={textSecondary}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  action: {
    alignSelf: 'center',
    marginTop: spacing.sm,
  },
  runningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  runningText: {
    gap: spacing.xxs,
  },
  line: {
    ...typography.bodySmall,
  },
  centred: {
    textAlign: 'center',
    marginTop: spacing.sm,
  },
});
