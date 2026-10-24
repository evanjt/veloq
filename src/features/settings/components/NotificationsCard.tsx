/**
 * The small feed card that asks for personalised notifications.
 *
 * It asks from the second launch while notifications are off, and not at all
 * where pushes cannot arrive, once the tour's notification slide was answered
 * Never, or after Never remind me here. Enable raises the system prompt, and
 * only a grant records consent and turns them on. Whether it shows is the
 * session's one ask.
 */
import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { useAuthStore } from '@/shared/app/AuthStore';
import { openExternal } from '@/shared/app/openExternal';
import { sourceFor } from '@/shared/app/source';
import { VELOQ_PRIVACY_URL } from '@/shared/app/supportLinks';
import { Button, PermissionNotice, TextLink } from '@/shared/ui';
import { Card } from '@/shared/ui/Card';
import { colors, darkColors, spacing, typography } from '@/theme';

import { useSessionAsk } from '../hooks/useLaunchSurfaces';
import { requestNotificationPermission } from '../lib/notificationService';
import { useNotificationPreferences } from '../stores/NotificationPreferencesStore';
import { useNotificationPrompt } from '../stores/NotificationPromptStore';
import { useWhatsNewStore } from '../stores/WhatsNewStore';

export function NotificationsCard() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const authMethod = useAuthStore((s) => s.authMethod);
  const preferencesLoaded = useNotificationPreferences((s) => s.isLoaded);
  const enabled = useNotificationPreferences((s) => s.enabled);
  const setEnabled = useNotificationPreferences((s) => s.setEnabled);
  const acceptPrivacy = useNotificationPreferences((s) => s.acceptPrivacy);
  const promptLoaded = useNotificationPrompt((s) => s.isLoaded);
  const dismissed = useNotificationPrompt((s) => s.dismissed);
  const dismiss = useNotificationPrompt((s) => s.dismiss);
  const tourAnswer = useWhatsNewStore((s) => s.tourOffer.answers.notifications);
  const [enabling, setEnabling] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const canPush = isAuthenticated && sourceFor({ authMethod, isDemoMode })?.can.push === true;
  const eligible =
    canPush &&
    preferencesLoaded &&
    promptLoaded &&
    !enabled &&
    !dismissed &&
    tourAnswer !== 'never';
  const holdsAsk = useSessionAsk('notifications', eligible);

  // Turning on registers the athlete id and a push token on our server, so the
  // disclosure is one tap away here and the tap that turns on is the consent.
  const enable = useCallback(async () => {
    setEnabling(true);
    const outcome = await requestNotificationPermission();
    if (outcome === 'granted') {
      acceptPrivacy();
      setEnabled(true);
    }
    setBlocked(outcome === 'blocked');
    setEnabling(false);
  }, [acceptPrivacy, setEnabled]);

  if (!eligible || !holdsAsk) return null;

  const palette = isDark ? darkColors : colors;

  return (
    <View testID="notifications-card">
      <Card variant="raised" style={{ gap: spacing.xs }}>
        <Text style={[styles.title, { color: palette.textPrimary }]}>
          {t('feed.notificationsTitle')}
        </Text>
        <Text style={[styles.description, { color: palette.textSecondary }]}>
          {t('feed.notificationsBody')}
        </Text>
        {expanded ? (
          <>
            <Text style={[styles.description, { color: palette.textSecondary }]}>
              {t('notifications.privacy.brief')}
            </Text>
            <TextLink
              label={t('login.privacyPolicy')}
              onPress={() => {
                void openExternal(VELOQ_PRIVACY_URL);
              }}
            />
          </>
        ) : null}
        {blocked ? (
          <PermissionNotice
            testID="notifications-card-blocked"
            outcome="blocked"
            icon="bell-off-outline"
            reason={t('permissionNotice.notificationsOff')}
            onAllow={enable}
          />
        ) : null}
        <View style={styles.actions}>
          <TextLink
            label={t('notifications.prompt.howItWorks')}
            onPress={() => setExpanded((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            testID="notifications-card-details"
          />
          <View style={styles.buttons}>
            <Button
              testID="notifications-card-never"
              label={t('whatsNew.tutorial.neverRemind')}
              variant="ghost"
              size="sm"
              onPress={dismiss}
            />
            <Button
              testID="notifications-card-enable"
              label={t('whatsNew.tutorial.turnOn')}
              variant="primary"
              size="sm"
              onPress={enable}
              disabled={enabling}
            />
          </View>
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    ...typography.bodyBold,
  },
  description: {
    ...typography.bodySmall,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  buttons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
