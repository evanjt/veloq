import React, { useCallback, useState } from 'react';
import { View, StyleSheet, Pressable, Linking } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useTheme } from '@/shared/app';
import { useAuthStore } from '@/shared/app/AuthStore';
import {
  useNotificationPreferences,
  isPrivacyNoticeOwed,
  useNotificationPrompt,
} from '@/features/settings';
import { requestNotificationPermission } from '@/features/settings/lib/notificationService';
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import { pressable, pressRipple } from '@/shared/ui';
import { Card } from '@/shared/ui/Card';

export function NotificationOptInCard() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const authMethod = useAuthStore((s) => s.authMethod);
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const notificationsEnabled = useNotificationPreferences((s) => s.enabled);
  const setNotificationsEnabled = useNotificationPreferences((s) => s.setEnabled);
  const acceptPrivacy = useNotificationPreferences((s) => s.acceptPrivacy);
  const isPromptLoaded = useNotificationPrompt((s) => s.isLoaded);
  const dismissed = useNotificationPrompt((s) => s.dismissed);
  const showingSettingsHint = useNotificationPrompt((s) => s.showingSettingsHint);
  const dismiss = useNotificationPrompt((s) => s.dismiss);
  const owed = useNotificationPreferences(isPrivacyNoticeOwed);
  const [enabling, setEnabling] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const isOAuth = authMethod === 'oauth';
  const shouldOptIn =
    isOAuth && !isDemoMode && !notificationsEnabled && !dismissed && isPromptLoaded;

  // The owed notice is the one thing the card must say, so it is never collapsed.
  const disclosed = owed || expanded;

  // Turning on registers the athlete id and a push token on our server, so the
  // disclosure is one tap away in this card and the tap that turns on is the consent.
  const turnOn = useCallback(async () => {
    setEnabling(true);
    const granted = await requestNotificationPermission();
    if (granted) {
      acceptPrivacy();
      setNotificationsEnabled(true);
    }
    setEnabling(false);
  }, [acceptPrivacy, setNotificationsEnabled]);

  const turnOff = useCallback(() => setNotificationsEnabled(false), [setNotificationsEnabled]);

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

  if (!owed && !shouldOptIn) return null;

  return (
    <Animated.View entering={FadeIn.duration(300)} exiting={FadeOut.duration(200)}>
      <Card variant="raised" style={{ gap: spacing.sm }}>
        {/* Header */}
        <View style={styles.header}>
          <MaterialCommunityIcons
            name="bell-ring-outline"
            size={22}
            color={isDark ? darkColors.textPrimary : colors.textPrimary}
          />
          <Text style={[styles.title, isDark && styles.titleDark]}>
            {t(owed ? 'notifications.privacy.title' : 'notifications.prompt.title')}
          </Text>
        </View>

        {!owed && (
          <Text style={[styles.description, isDark && styles.descriptionDark]}>
            {t('notifications.prompt.description')}
          </Text>
        )}
        {!owed && (
          <Text
            onPress={() => setExpanded((v) => !v)}
            accessibilityRole="link"
            accessibilityState={{ expanded }}
            style={[styles.linkText, isDark && styles.linkTextDark]}
          >
            {t('notifications.prompt.howItWorks')}
          </Text>
        )}
        {disclosed && (
          <>
            <Text style={[styles.description, isDark && styles.descriptionDark]}>
              {t(owed ? 'notifications.privacy.briefEnabled' : 'notifications.privacy.brief')}
            </Text>
            <Text
              onPress={() => Linking.openURL('https://veloq.fit/privacy')}
              style={[styles.linkText, isDark && styles.linkTextDark]}
            >
              {t('login.privacyPolicy')}
            </Text>
          </>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          <Pressable
            onPress={owed ? turnOff : dismiss}
            hitSlop={8}
            style={pressable()}
            android_ripple={pressRipple}
          >
            <Text style={[styles.dismissText, isDark && styles.dismissTextDark]}>
              {t(owed ? 'notifications.privacy.turnOff' : 'notifications.prompt.dismiss')}
            </Text>
          </Pressable>
          <Pressable
            onPress={owed ? acceptPrivacy : turnOn}
            disabled={enabling}
            style={pressable([styles.enableButton, enabling && styles.enableButtonDisabled])}
            android_ripple={pressRipple}
          >
            <Text style={styles.enableText}>
              {t(owed ? 'notifications.prompt.keep' : 'notifications.prompt.enable')}
            </Text>
          </Pressable>
        </View>
      </Card>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
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
  linkText: {
    ...typography.bodySmall,
    color: colors.linkTeal,
  },
  linkTextDark: {
    color: darkColors.linkTeal,
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
