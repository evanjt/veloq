import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Linking, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import {
  requestNotificationPermission,
  hasNotificationPermission,
} from '@/features/settings/lib/notificationService';
import { colors, darkColors, layout, spacing, typography } from '@/theme';
import { settingsStyles } from './settingsStyles';
import {
  ListSectionHeader,
  pressable,
  pressRipple,
  PermissionNotice,
  SwitchRow,
} from '@/shared/ui';
import { confirmAction } from '@/shared/ui/dialog';

/**
 * The kinds of push the athlete can turn off one at a time. Both flags shipped
 * in the store with no way to set them, so the ladder's rungs were gated by
 * preferences nobody could reach.
 */
const CATEGORIES = [
  { id: 'sectionPr', label: 'notifications.settings.sectionPr' },
  { id: 'fitnessMilestone', label: 'notifications.settings.fitnessMilestone' },
] as const;

export function NotificationSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const authMethod = useAuthStore((s) => s.authMethod);
  const isOAuth = authMethod === 'oauth';
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const { enabled, privacyAccepted, categories, setEnabled, acceptPrivacy, setCategoryEnabled } =
    useNotificationPreferences();
  const [toggling, setToggling] = useState(false);
  // Set when the system will no longer show its dialog, so the switch alone cannot turn on.
  const [blocked, setBlocked] = useState(false);

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

  const turnOnWithPermission = useCallback(async () => {
    setToggling(true);
    const outcome = await requestNotificationPermission();
    if (outcome === 'granted') {
      setEnabled(true);
    }
    setBlocked(outcome === 'blocked');
    setToggling(false);
  }, [setEnabled]);

  const handlePrivacyAccept = useCallback(async () => {
    acceptPrivacy();
    await turnOnWithPermission();
  }, [acceptPrivacy, turnOnWithPermission]);

  // The notice that has to be read before a push token leaves the device: it
  // names what is stored on the server and who routes the notification.
  // Dismissing it, by the back gesture or a tap outside, is a decline.
  const showPrivacyNotice = useCallback(() => {
    confirmAction({
      title: t('notifications.privacy.title'),
      message: t('notifications.privacy.brief'),
      confirmLabel: t('notifications.privacy.accept'),
      cancelLabel: t('common.cancel'),
      onConfirm: handlePrivacyAccept,
    });
  }, [t, handlePrivacyAccept]);

  const handleMainToggle = useCallback(
    async (value: boolean) => {
      if (!canEnable) return;

      if (value) {
        if (!privacyAccepted) {
          showPrivacyNotice();
          return;
        }
        await turnOnWithPermission();
      } else {
        setEnabled(false);
      }
    },
    [canEnable, privacyAccepted, setEnabled, showPrivacyNotice, turnOnWithPermission]
  );

  return (
    <>
      <ListSectionHeader>{t('notifications.settings.title')}</ListSectionHeader>
      <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
        <SwitchRow
          icon="bell-outline"
          title={t('notifications.settings.enable')}
          value={enabled}
          onValueChange={handleMainToggle}
          disabled={(!canEnable && !enabled) || toggling}
          testID="settings-notifications-toggle"
        />

        {blocked && !enabled && (
          <View style={styles.notice}>
            <PermissionNotice
              testID="settings-notifications-blocked"
              outcome="blocked"
              icon="bell-off-outline"
              reason={t('permissionNotice.notificationsOff')}
              onAllow={turnOnWithPermission}
            />
          </View>
        )}

        {CATEGORIES.map((category) => (
          <SwitchRow
            key={category.id}
            inset="nested"
            title={t(category.label)}
            value={categories[category.id]}
            onValueChange={(next) => setCategoryEnabled(category.id, next)}
            // A switch that can be moved while notifications are off promises
            // a push that will not arrive.
            disabled={!enabled || !canEnable || toggling}
            testID={`settings-notifications-${category.id}`}
          />
        ))}

        {!canEnable ? (
          <Text
            testID="settings-notifications-oauth-hint"
            style={[settingsStyles.hintText, isDark && settingsStyles.textSecondary]}
          >
            {t('notifications.settings.requiresOAuth')}
          </Text>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('notifications.settings.privacyHint')}
            onPress={() => Linking.openURL('https://veloq.fit/privacy')}
            style={pressable(styles.privacyRow)}
            android_ripple={pressRipple}
          >
            <MaterialCommunityIcons
              name="information-outline"
              size={14}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
            />
            <Text style={[styles.privacyText, isDark && settingsStyles.textSecondary]}>
              {t('notifications.settings.privacyHint')}
            </Text>
          </Pressable>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  notice: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  privacyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    minHeight: layout.minTapTarget,
  },
  privacyText: {
    ...typography.label,
    color: colors.textSecondary,
    textTransform: 'none',
  },
});
