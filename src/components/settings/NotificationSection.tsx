import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Linking, Pressable, Modal, Text as RNText } from 'react-native';
import { Text, Switch } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { useAuthStore, useNotificationPreferences } from '@/providers';
import {
  requestNotificationPermission,
  hasNotificationPermission,
} from '@/lib/notifications/notificationService';
import { colors, darkColors, spacing, typography, layout, shadows } from '@/theme';
import { settingsStyles } from './settingsStyles';

export function NotificationSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const authMethod = useAuthStore((s) => s.authMethod);
  const isOAuth = authMethod === 'oauth';
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const { enabled, privacyAccepted, setEnabled, acceptPrivacy } = useNotificationPreferences();
  const [toggling, setToggling] = useState(false);
  const [showPrivacyDialog, setShowPrivacyDialog] = useState(false);

  const canEnable = isOAuth && !isDemoMode;

  useEffect(() => {
    if (enabled) {
      hasNotificationPermission().then((granted) => {
        if (!granted) {
          setEnabled(false);
        }
      });
    }
  }, [enabled, setEnabled]);

  const handlePrivacyAccept = useCallback(async () => {
    setShowPrivacyDialog(false);
    acceptPrivacy();
    setToggling(true);
    const granted = await requestNotificationPermission();
    if (granted) {
      setEnabled(true);
    }
    setToggling(false);
  }, [acceptPrivacy, setEnabled]);

  const handleMainToggle = useCallback(
    async (value: boolean) => {
      if (!canEnable) return;

      if (value) {
        if (!privacyAccepted) {
          setShowPrivacyDialog(true);
          return;
        }
        setToggling(true);
        const granted = await requestNotificationPermission();
        if (granted) {
          setEnabled(true);
        }
        setToggling(false);
      } else {
        setEnabled(false);
      }
    },
    [canEnable, privacyAccepted, setEnabled]
  );

  const bg = isDark ? darkColors.surface : colors.surface;
  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <>
      <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
        {t('notifications.settings.title').toUpperCase()}
      </Text>
      <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
        <View style={styles.row}>
          <MaterialCommunityIcons
            name="bell-outline"
            size={20}
            color={isDark ? darkColors.textPrimary : colors.textPrimary}
          />
          <Text style={[styles.rowLabel, isDark && settingsStyles.textLight]} numberOfLines={1}>
            {t('notifications.settings.enable')}
          </Text>
          <Switch
            value={enabled}
            onValueChange={handleMainToggle}
            disabled={!canEnable || toggling}
            color={colors.primary}
            testID="settings-notifications-toggle"
          />
        </View>

        {!canEnable ? (
          <Text
            testID="settings-notifications-oauth-hint"
            style={[settingsStyles.hintText, isDark && settingsStyles.textMuted]}
          >
            {t('notifications.settings.requiresOAuth')}
          </Text>
        ) : (
          <Pressable
            onPress={() => Linking.openURL('https://veloq.fit/privacy')}
            style={styles.privacyRow}
          >
            <MaterialCommunityIcons
              name="information-outline"
              size={14}
              color={isDark ? darkColors.textMuted : colors.textMuted}
            />
            <Text style={[styles.privacyText, isDark && settingsStyles.textMuted]}>
              {t('notifications.settings.privacyHint')}
            </Text>
          </Pressable>
        )}
      </View>

      <Modal
        visible={showPrivacyDialog}
        transparent
        animationType="fade"
        onRequestClose={() => setShowPrivacyDialog(false)}
      >
        <View style={styles.overlay}>
          <View style={[styles.dialog, { backgroundColor: bg }]}>
            <View style={styles.dialogHeader}>
              <MaterialCommunityIcons
                name="shield-check-outline"
                size={24}
                color={colors.primary}
              />
              <RNText style={[styles.dialogTitle, { color: textColor }]}>
                {t('notifications.privacy.title')}
              </RNText>
            </View>
            <RNText style={[styles.dialogBody, { color: textSecondary }]}>
              {t('notifications.privacy.brief')}
            </RNText>
            <View style={styles.dialogActions}>
              <Pressable style={styles.cancelBtn} onPress={() => setShowPrivacyDialog(false)}>
                <RNText style={[styles.cancelText, { color: textSecondary }]}>
                  {t('common.cancel')}
                </RNText>
              </Pressable>
              <Pressable style={styles.acceptBtn} onPress={handlePrivacyAccept}>
                <RNText style={styles.acceptText}>{t('notifications.privacy.accept')}</RNText>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  rowLabel: {
    ...typography.body,
    flex: 1,
    color: colors.textPrimary,
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  privacyText: {
    ...typography.label,
    color: colors.textMuted,
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
    color: '#fff',
    fontSize: typography.body.fontSize,
    fontWeight: '600',
  },
});
