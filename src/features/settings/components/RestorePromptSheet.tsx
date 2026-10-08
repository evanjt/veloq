/**
 * The one-time offer to restore on an empty signed-in library.
 *
 * Shown in the restore sheet route when no platform record was applied, so an
 * athlete on a new phone is told that a backup in a file or on a WebDAV server
 * can come back. Dismissing it, swiping the sheet away, or restoring, answers it
 * for good.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@/shared/ui';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing, typography } from '@/theme';

import { answerRestorePrompt } from '../lib/restorePrompt';
import { RestoreChooser } from './RestoreChooser';

interface RestorePromptSheetProps {
  onClose: () => void;
}

export function RestorePromptSheet({ onClose }: RestorePromptSheetProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [busy, setBusy] = useState(false);

  // A swipe-down unmounts the sheet without a tap, and counts as the dismiss.
  useEffect(() => answerRestorePrompt, []);

  const finish = useCallback(() => {
    answerRestorePrompt();
    onClose();
  }, [onClose]);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View testID="restore-prompt-sheet" style={[styles.sheet, isDark && styles.sheetDark]}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
          <Text style={[styles.title, isDark && styles.textLight]}>
            {t('backup.restorePromptTitle')}
          </Text>
          <Text style={[styles.body, isDark && styles.textSecondary]}>
            {t('backup.restorePromptMessage')}
          </Text>
          <RestoreChooser onRestored={finish} onBusyChange={setBusy} />
          <Button
            testID="restore-prompt-dismiss"
            label={t('backup.restorePromptDismiss')}
            variant="ghost"
            onPress={finish}
            disabled={busy}
          />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  sheet: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  sheetDark: {
    backgroundColor: darkColors.surface,
  },
  content: {
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: {
    ...typography.cardTitle,
    color: colors.textPrimary,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  textSecondary: {
    color: darkColors.textSecondary,
  },
});
