import React, { useCallback, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useTheme } from '@/shared/app';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import { useNotificationPrompt } from '@/features/settings/stores/NotificationPromptStore';
import { requestNotificationPermission } from '@/features/settings/lib/notificationService';
import { NotificationPrivacyDialog } from '@/features/settings';
import { colors, darkColors, spacing, layout, shadows, typography } from '@/theme';
import { pressable } from '@/shared/ui';

export function NotificationOptInCard() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const authMethod = useAuthStore((s) => s.authMethod);
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const notificationsEnabled = useNotificationPreferences((s) => s.enabled);
  const privacyAccepted = useNotificationPreferences((s) => s.privacyAccepted);
  const setNotificationsEnabled = useNotificationPreferences((s) => s.setEnabled);
  const acceptPrivacy = useNotificationPreferences((s) => s.acceptPrivacy);
  const isPromptLoaded = useNotificationPrompt((s) => s.isLoaded);
  const dismissed = useNotificationPrompt((s) => s.dismissed);
  const showingSettingsHint = useNotificationPrompt((s) => s.showingSettingsHint);
  const dismiss = useNotificationPrompt((s) => s.dismiss);
  const [enabling, setEnabling] = useState(false);
  const [showPrivacyDialog, setShowPrivacyDialog] = useState(false);

  const isOAuth = authMethod === 'oauth';
  const shouldShow =
    isOAuth && !isDemoMode && !notificationsEnabled && !dismissed && isPromptLoaded;

  const enable = useCallback(async () => {
    setEnabling(true);
    const granted = await requestNotificationPermission();
    if (granted) {
      setNotificationsEnabled(true);
    }
    setEnabling(false);
  }, [setNotificationsEnabled]);

  // This card's own copy says nothing about the athlete id and the push token
  // going to a server, so the notice that does has to be read here too. The
  // settings toggle asks the same way.
  const handleEnable = useCallback(() => {
    if (!privacyAccepted) {
      setShowPrivacyDialog(true);
      return;
    }
    void enable();
  }, [privacyAccepted, enable]);

  const handlePrivacyAccept = useCallback(() => {
    setShowPrivacyDialog(false);
    acceptPrivacy();
    void enable();
  }, [acceptPrivacy, enable]);

  // Show settings hint after dismissal
  if (showingSettingsHint) {
    return (
      <Animated.View
        entering={FadeIn.duration(200)}
        exiting={FadeOut.duration(300)}
        style={[styles.hintContainer, isDark && styles.hintContainerDark]}
      >
        <MaterialCommunityIcons
          name="cog-outline"
          size={16}
          color={isDark ? darkColors.textSecondary : colors.textSecondary}
        />
        <Text style={[styles.hintText, isDark && styles.hintTextDark]}>
          {t('notifications.prompt.settingsHint')}
        </Text>
      </Animated.View>
    );
  }

  if (!shouldShow) return null;

  return (
    <>
      <Animated.View
        entering={FadeIn.duration(300)}
        exiting={FadeOut.duration(200)}
        style={[styles.card, isDark && styles.cardDark]}
      >
        {/* Header */}
        <View style={styles.header}>
          <MaterialCommunityIcons
            name="bell-ring-outline"
            size={22}
            color={isDark ? darkColors.textPrimary : colors.textPrimary}
          />
          <Text style={[styles.title, isDark && styles.titleDark]}>
            {t('notifications.prompt.title')}
          </Text>
        </View>

        {/* Description */}
        <Text style={[styles.description, isDark && styles.descriptionDark]}>
          {t('notifications.prompt.description')}
        </Text>

        {/* Actions */}
        <View style={styles.actions}>
          <Pressable onPress={dismiss} hitSlop={8} style={pressable()}>
            <Text style={[styles.dismissText, isDark && styles.dismissTextDark]}>
              {t('notifications.prompt.dismiss')}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleEnable}
            disabled={enabling}
            style={pressable([styles.enableButton, enabling && styles.enableButtonDisabled])}
          >
            <Text style={styles.enableText}>{t('notifications.prompt.enable')}</Text>
          </Pressable>
        </View>
      </Animated.View>

      <NotificationPrivacyDialog
        visible={showPrivacyDialog}
        onCancel={() => setShowPrivacyDialog(false)}
        onAccept={handlePrivacyAccept}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: layout.screenPadding,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.card,
  },
  cardDark: {
    backgroundColor: darkColors.surfaceCard,
    ...shadows.none,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    ...typography.body,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  titleDark: {
    color: darkColors.textPrimary,
  },
  description: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  descriptionDark: {
    color: darkColors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: spacing.lg,
    paddingTop: spacing.xs,
  },
  dismissText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
  dismissTextDark: {
    color: darkColors.textSecondary,
  },
  enableButton: {
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: layout.borderRadiusSm,
  },
  enableButtonDisabled: {
    opacity: 0.6,
  },
  enableText: {
    ...typography.bodySmall,
    fontWeight: '600',
    color: colors.textOnPrimary,
  },
  hintContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginHorizontal: layout.screenPadding,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.background,
    borderRadius: layout.borderRadiusSm,
  },
  hintContainerDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  hintText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  hintTextDark: {
    color: darkColors.textSecondary,
  },
});
