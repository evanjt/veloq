/**
 * Status line for the elevation backfill.
 *
 * The backfill starts on its own after an update, so this is a read-only
 * surface. The queue length is only known once a run has started, so the line
 * reports a count rather than a bar, and each terminal state reads distinctly.
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
import { useElevationBackfill } from '@/features/routes/hooks/useElevationBackfill';
import { colors, darkColors, spacing, typography, layout, shadows } from '@/theme';

export function ElevationBackfillStatus() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { phase, completed, total, failed } = useElevationBackfill();
  const [showWhy, setShowWhy] = useState(false);

  const textPrimary = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;
  const textMuted = isDark ? darkColors.textMuted : colors.textMuted;
  const surface = isDark ? darkColors.surface : colors.surface;
  const danger = isDark ? darkColors.error : colors.error;

  if (phase === 'idle') return null;

  const status =
    phase === 'fetching' ? (
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

      {phase !== 'complete' && (
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
