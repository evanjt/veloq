/**
 * The tour's notification slide: example notifications drawn from the sentences
 * a posted one is built from, and the one place the app asks for them.
 *
 * Turn on raises the system prompt, and only a grant records consent, the
 * preference and the slide's answer. Never remind me again records the answer
 * alone, so neither this slide nor the tour's leftover card asks again. Where
 * pushes cannot arrive the examples show with no buttons.
 */

import React, { useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { useAuthStore } from '@/shared/app/AuthStore';
import { sourceFor } from '@/shared/app/source';
import { openExternal } from '@/shared/app/openExternal';
import { VELOQ_PRIVACY_URL } from '@/shared/app/supportLinks';
import { Button, PermissionNotice, TextLink } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { colors, darkColors, iconSize, layout, spacing, typography } from '@/theme';
import { requestNotificationPermission } from '../../lib/notificationService';
import { useNotificationPreferences } from '../../stores/NotificationPreferencesStore';
import { useWhatsNewStore } from '../../stores/WhatsNewStore';
import { tourPanelColour } from './tourPanel';

/** What the engine puts between the finding and the activity's name in a notification body. */
const BODY_SEPARATOR = ' - ';

interface Example {
  titleKey: string;
  bodyKey: string;
  values: (t: (key: string, values?: object) => string) => object;
  /** The invented activity the finding came from, or none for a fitness milestone. */
  activityKey?: string;
}

/** One example per tier the engine posts: a PR, faster than usual, and a fitness milestone. */
const EXAMPLES: Example[] = [
  {
    titleKey: 'notifications.activityPr.title',
    bodyKey: 'notifications.activityBody.sectionPrDelta',
    values: (t) => ({
      name: t('whatsNew.tutorial.notificationsExampleSection'),
      delta: t('units.secondsValue', { value: 12 }),
    }),
    activityKey: 'whatsNew.tutorial.notificationsExampleRide',
  },
  {
    titleKey: 'notifications.activityFaster.title',
    bodyKey: 'notifications.activityBody.fasterOnRouteDelta',
    values: (t) => ({
      name: t('whatsNew.tutorial.notificationsExampleRoute'),
      delta: t('units.secondsValue', { value: 48 }),
    }),
    activityKey: 'whatsNew.tutorial.notificationsExampleRun',
  },
  {
    titleKey: 'notifications.activityRecorded.title',
    bodyKey: 'insights.ftpIncrease',
    values: () => ({ current: 262, change: 6 }),
  },
];

export function NotificationsSlide() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const translate = t as unknown as (key: string, values?: object) => string;
  const authMethod = useAuthStore((s) => s.authMethod);
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const enabled = useNotificationPreferences((s) => s.enabled);
  const setEnabled = useNotificationPreferences((s) => s.setEnabled);
  const acceptPrivacy = useNotificationPreferences((s) => s.acceptPrivacy);
  const answered = useWhatsNewStore((s) => s.tourOffer.answers.notifications);
  const answerSetup = useWhatsNewStore((s) => s.answerSetup);
  const [enabling, setEnabling] = useState(false);
  // Set when the system will no longer show its dialog, so Turn on alone would do nothing.
  const [blocked, setBlocked] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const canPush = sourceFor({ authMethod, isDemoMode })?.can.push === true;
  const palette = isDark ? darkColors : colors;
  const panel = tourPanelColour(isDark);

  // Turning on registers the athlete id and a push token on our server, so the
  // disclosure is one tap away here and the tap that turns on is the consent.
  const turnOn = useCallback(async () => {
    setEnabling(true);
    const outcome = await requestNotificationPermission();
    if (outcome === 'granted') {
      acceptPrivacy();
      setEnabled(true);
      answerSetup('notifications', 'on');
    }
    setBlocked(outcome === 'blocked');
    setEnabling(false);
  }, [acceptPrivacy, setEnabled, answerSetup]);

  const never = useCallback(() => answerSetup('notifications', 'never'), [answerSetup]);

  // In place of the buttons, the one line that says why there is nothing to answer.
  const status = !canPush
    ? t('whatsNew.tutorial.notificationsNeedSignIn')
    : enabled
      ? t('whatsNew.tutorial.notificationsOn')
      : answered === 'never'
        ? t('notifications.prompt.settingsHint')
        : null;

  return (
    <View style={styles.container}>
      {EXAMPLES.map((example) => {
        const finding = translate(example.bodyKey, example.values(translate));
        const body = example.activityKey
          ? `${finding}${BODY_SEPARATOR}${translate(example.activityKey)}`
          : finding;
        return (
          <View
            key={example.titleKey}
            style={[styles.example, { backgroundColor: panel }]}
            testID="tour-notification-example"
          >
            <Icon name="bell-outline" size={iconSize.md} color={palette.actionPrimary} />
            <View style={styles.exampleText}>
              <Text
                style={[styles.exampleTitle, { color: palette.textPrimary }]}
                testID="tour-notification-example-title"
              >
                {translate(example.titleKey)}
              </Text>
              <Text
                style={[styles.exampleBody, { color: palette.textSecondary }]}
                testID="tour-notification-example-body"
              >
                {body}
              </Text>
            </View>
          </View>
        );
      })}

      {status ? (
        <Text style={[styles.status, { color: palette.textSecondary }]}>{status}</Text>
      ) : (
        <>
          {expanded ? (
            <>
              <Text style={[styles.status, { color: palette.textSecondary }]}>
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
          <TextLink
            label={t('notifications.prompt.howItWorks')}
            onPress={() => setExpanded((v) => !v)}
            accessibilityRole="button"
            accessibilityState={{ expanded }}
            testID="tour-notifications-details"
          />
          {blocked ? (
            <PermissionNotice
              testID="tour-notifications-blocked"
              outcome="blocked"
              icon="bell-off-outline"
              reason={t('permissionNotice.notificationsOff')}
              onAllow={turnOn}
            />
          ) : null}
          <View style={styles.actions}>
            <Button
              testID="tour-notifications-never"
              label={t('whatsNew.tutorial.neverRemind')}
              variant="ghost"
              size="sm"
              onPress={never}
            />
            <Button
              testID="tour-notifications-turn-on"
              label={t('whatsNew.tutorial.turnOn')}
              variant="primary"
              size="sm"
              onPress={turnOn}
              disabled={enabling}
            />
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    alignItems: 'stretch',
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  example: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: layout.borderRadiusMd,
    padding: spacing.sm,
    gap: spacing.sm,
  },
  exampleText: {
    flex: 1,
  },
  exampleTitle: {
    ...typography.bodyBold,
  },
  exampleBody: {
    ...typography.bodySmall,
  },
  status: {
    ...typography.bodySmall,
    textAlign: 'center',
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.lg,
  },
});
