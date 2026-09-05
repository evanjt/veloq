/**
 * Status line for the elevation backfill.
 *
 * The backfill starts on its own after an update. The one control here is a
 * pause, which ends the run in flight and holds until the app is next opened.
 * The queue length is only known once a run has started, so the line reports
 * a count rather than a bar, and each terminal state reads distinctly.
 *
 * Nothing else tells the user why the download is happening: the detector flip
 * is held behind the queue draining, and that gate is silent. So the line also
 * says what is waiting on it, with a Why control for the longer answer.
 */

import React, { useState } from 'react';
import {
  View,
  ActivityIndicator,
  StyleSheet,
  Modal,
  Pressable,
  Text as RNText,
} from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { getEngine } from '@/shared/native/engine';
import { useElevationBackfill } from '@/features/routes/hooks/useElevationBackfill';
import { colors, darkColors, spacing, typography, layout, shadows } from '@/theme';

export function ElevationBackfillStatus() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { phase, completed, total, failed, remaining } = useElevationBackfill();
  const [showWhy, setShowWhy] = useState(false);

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const textMuted = isDark ? darkColors.textMuted : colors.textMuted;
  const surface = isDark ? darkColors.surface : colors.surface;
  const danger = isDark ? darkColors.error : colors.error;

  // The phase is a process-global that starts at `idle`, so at rest it says
  // nothing about the library. The outstanding count is the durable fact:
  // a positive count is work owed, zero is nothing owed, and null is an engine
  // that could not answer, which must not read as a finished backfill.
  const outstandingAtRest = phase === 'idle' && remaining !== null && remaining > 0;
  if (phase === 'idle' && !outstandingAtRest) return null;

  // A pass is either running or armed to run again, so both states can be
  // paused. Once every track has elevation there is nothing left to stop.
  const pausable = phase === 'fetching' || phase === 'partial' || outstandingAtRest;

  const status = outstandingAtRest ? (
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

      {pausable && (
        <Pressable
          style={styles.pauseRow}
          onPress={() => getEngine()?.pauseElevationBackfill()}
          testID="elevation-backfill-pause"
        >
          <MaterialCommunityIcons name="pause-circle-outline" size={16} color={colors.primary} />
          <Text style={[styles.pauseText, { color: colors.primary }]}>
            {t('settings.elevationBackfillPause')}
          </Text>
        </Pressable>
      )}

      {phase !== 'complete' && phase !== 'paused' && (
        <Text
          style={[styles.line, styles.centred, { color: textMuted }]}
          testID="elevation-backfill-explainer"
        >
          {t('settings.elevationBackfillExplainer')}
        </Text>
      )}

      <Pressable
        style={styles.whyRow}
        onPress={() => setShowWhy(true)}
        testID="elevation-backfill-why"
      >
        <MaterialCommunityIcons name="information-outline" size={14} color={textMuted} />
        <Text style={[styles.whyText, { color: textMuted }]}>
          {t('settings.elevationBackfillWhy')}
        </Text>
      </Pressable>

      <Modal
        visible={showWhy}
        transparent
        animationType="fade"
        onRequestClose={() => setShowWhy(false)}
      >
        <View style={styles.overlay}>
          <View style={[styles.dialog, { backgroundColor: surface }]}>
            <View style={styles.dialogHeader}>
              <MaterialCommunityIcons name="terrain" size={24} color={colors.primary} />
              <RNText style={[styles.dialogTitle, { color: textPrimary }]}>
                {t('settings.elevationBackfillWhyTitle')}
              </RNText>
            </View>
            <RNText
              style={[styles.dialogBody, { color: textSecondary }]}
              testID="elevation-backfill-why-body"
            >
              {t('settings.elevationBackfillWhyBody')}
            </RNText>
            <View style={styles.dialogActions}>
              <Pressable
                style={styles.closeBtn}
                onPress={() => setShowWhy(false)}
                testID="elevation-backfill-why-close"
              >
                <RNText style={[styles.closeText, { color: colors.primary }]}>
                  {t('common.close')}
                </RNText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  runningRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  runningText: {
    gap: 2,
  },
  line: {
    ...typography.bodySmall,
  },
  centred: {
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  pauseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
  },
  pauseText: {
    ...typography.body,
    fontWeight: '500',
  },
  whyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  whyText: {
    ...typography.label,
    textTransform: 'none',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.lg,
  },
  dialog: {
    width: '100%',
    maxWidth: 400,
    borderRadius: layout.borderRadius,
    padding: spacing.lg,
    ...shadows.modal,
  },
  dialogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  dialogTitle: {
    fontSize: typography.cardTitle.fontSize,
    fontWeight: '600',
  },
  dialogBody: {
    fontSize: typography.bodySmall.fontSize,
    lineHeight: 22,
    marginBottom: spacing.lg,
  },
  dialogActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  closeBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  closeText: {
    fontSize: typography.body.fontSize,
    fontWeight: '500',
  },
});
