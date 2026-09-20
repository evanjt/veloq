import React from 'react';
import { Modal, View, Text, Pressable, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import {
  colors,
  darkColors,
  spacing,
  layout,
  typography,
  shadows,
  ink,
  colorWithOpacity,
} from '@/theme';

import { pressable } from '@/shared/ui';

interface Props {
  visible: boolean;
  onCancel: () => void;
  onAccept: () => void;
}

/**
 * The notice that has to be read before a push token leaves the device: it
 * names what is stored on the server and who routes the notification. Both the
 * settings toggle and the home card enable notifications, so both show this.
 */
export function NotificationPrivacyDialog({ visible, onCancel, onAccept }: Props) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const bg = isDark ? darkColors.surface : colors.surface;
  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.overlay}>
        <View style={[styles.dialog, { backgroundColor: bg }]}>
          <View style={styles.dialogHeader}>
            <MaterialCommunityIcons name="shield-check-outline" size={24} color={colors.primary} />
            <Text style={[styles.dialogTitle, { color: textColor }]}>
              {t('notifications.privacy.title')}
            </Text>
          </View>
          <Text style={[styles.dialogBody, { color: textSecondary }]}>
            {t('notifications.privacy.brief')}
          </Text>
          <View style={styles.dialogActions}>
            <Pressable style={pressable(styles.cancelBtn)} onPress={onCancel}>
              <Text style={[styles.cancelText, { color: textSecondary }]}>
                {t('common.cancel')}
              </Text>
            </Pressable>
            <Pressable style={pressable(styles.acceptBtn)} onPress={onAccept}>
              <Text style={styles.acceptText}>{t('notifications.privacy.accept')}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: colorWithOpacity(ink.black, 0.5),
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
    gap: spacing.sm,
  },
  cancelBtn: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  cancelText: {
    fontSize: typography.body.fontSize,
    fontWeight: '500',
  },
  acceptBtn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: spacing.sm,
  },
  acceptText: {
    color: ink.white,
    fontSize: typography.body.fontSize,
    fontWeight: '600',
  },
});
