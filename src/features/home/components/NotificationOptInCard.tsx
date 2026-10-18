import React, { useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import Animated from 'react-native-reanimated';
import { useTheme } from '@/shared/app';
import { useAuthStore } from '@/shared/app/AuthStore';
import { sourceFor } from '@/shared/app/source';
import { openExternal } from '@/shared/app/openExternal';
import { VELOQ_PRIVACY_URL } from '@/shared/app/supportLinks';
import {
  useNotificationPreferences,
  isPrivacyNoticeOwed,
  useNotificationPrompt,
  requestNotificationPermission,
} from '@/features/settings';
import { colors, darkColors, iconSize, motionPresets, spacing, typography } from '@/theme';
import { Button, PermissionNotice, TextLink } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { Card } from '@/shared/ui/Card';

interface NotificationOptInCardProps {
  /** Activities the feed holds; the card asks nothing of an empty library. */
  libraryCount: number;
}

export function NotificationOptInCard({ libraryCount }: NotificationOptInCardProps) {
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
  // Set when the system will no longer show its dialog, so Enable alone would do nothing.
  const [blocked, setBlocked] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const shouldOptIn =
    sourceFor({ authMethod, isDemoMode })?.can.push === true &&
    !notificationsEnabled &&
    !dismissed &&
    isPromptLoaded;
  const mayShow = libraryCount > 0;

  // The owed notice is the one thing the card must say, so it is never collapsed.
  const disclosed = owed || expanded;

  // Turning on registers the athlete id and a push token on our server, so the
  // disclosure is one tap away in this card and the tap that turns on is the consent.
  const turnOn = useCallback(async () => {
    setEnabling(true);
    const outcome = await requestNotificationPermission();
    if (outcome === 'granted') {
      acceptPrivacy();
      setNotificationsEnabled(true);
    }
    setBlocked(outcome === 'blocked');
    setEnabling(false);
  }, [acceptPrivacy, setNotificationsEnabled]);

  const turnOff = useCallback(() => setNotificationsEnabled(false), [setNotificationsEnabled]);

  // Show settings hint after dismissal
  if (showingSettingsHint) {
    return (
      <Animated.View {...motionPresets.card}>
        <Card
          variant="flat"
          padding="sm"
          accessibilityLabel={t('notifications.prompt.settingsHint')}
          style={styles.hint}
        >
          <Icon
            name="cog-outline"
            size={iconSize.sm}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
          <Text style={[styles.hintText, isDark && styles.hintTextDark]}>
            {t('notifications.prompt.settingsHint')}
          </Text>
        </Card>
      </Animated.View>
    );
  }

  if (!mayShow || (!owed && !shouldOptIn)) return null;

  return (
    <Animated.View {...motionPresets.card}>
      <Card variant="raised" style={{ gap: spacing.sm }}>
        {/* Header */}
        <View style={styles.header}>
          <Icon
            name="bell-ring-outline"
            size={iconSize.lg}
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
          <TextLink
            label={t('notifications.prompt.howItWorks')}
            onPress={() => setExpanded((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
          />
        )}
        {disclosed ? (
          <>
            <Text style={[styles.description, isDark && styles.descriptionDark]}>
              {t(owed ? 'notifications.privacy.briefEnabled' : 'notifications.privacy.brief')}
            </Text>
            <TextLink
              label={t('login.privacyPolicy')}
              onPress={() => {
                void openExternal(VELOQ_PRIVACY_URL);
              }}
            />
          </>
        ) : null}

        {!owed && blocked ? (
          <PermissionNotice
            testID="notification-optin-blocked"
            outcome="blocked"
            icon="bell-off-outline"
            reason={t('permissionNotice.notificationsOff')}
            onAllow={turnOn}
          />
        ) : null}

        {/* Actions */}
        <View style={styles.actions}>
          <Button
            label={t(owed ? 'notifications.privacy.turnOff' : 'notifications.prompt.dismiss')}
            variant="ghost"
            size="sm"
            onPress={owed ? turnOff : dismiss}
          />
          <Button
            label={t(owed ? 'notifications.prompt.keep' : 'notifications.prompt.enable')}
            size="sm"
            onPress={owed ? acceptPrivacy : turnOn}
            disabled={enabling}
          />
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
    ...typography.bodyBold,
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
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  hintText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  hintTextDark: {
    color: darkColors.textSecondary,
  },
});
