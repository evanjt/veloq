import React, { useCallback, useState } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { useAuthStore } from '@/shared/app/AuthStore';
import { sourceFor } from '@/shared/app/source';
import { useNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import { useNotificationPermission } from '@/shared/app/permissions/notifications';
import { colors, darkColors, iconSize, layout, spacing, typography } from '@/theme';
import { settingsStyles } from './settingsStyles';
import { PermissionNotice, pressable, pressRipple, SwitchRow } from '@/shared/ui';
import { Icon } from '@/shared/ui/Icon';
import { confirmAction } from '@/shared/ui/dialog';
import { openExternal } from '@/shared/app/openExternal';
import { VELOQ_PRIVACY_URL } from '@/shared/app/supportLinks';

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
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const { enabled, privacyAccepted, categories, setEnabled, acceptPrivacy, setCategoryEnabled } =
    useNotificationPreferences();
  const [toggling, setToggling] = useState(false);
  const permission = useNotificationPermission();
  const requestPermission = permission.request;
  // Set when a tap on the switch found the system will no longer show its
  // dialog, so the switch alone cannot turn on.
  const [blocked, setBlocked] = useState(false);

  const canEnable = sourceFor({ authMethod, isDemoMode })?.can.push === true;

  // The athlete's choice is kept when the system setting is turned off, so a
  // re-grant there brings notifications back; the notice says why none arrive
  // meanwhile.
  const systemOff =
    enabled && permission.outcome !== null && permission.outcome !== 'granted'
      ? permission.outcome
      : null;
  const notice = systemOff ?? (blocked && !enabled ? 'blocked' : null);

  const turnOnWithPermission = useCallback(async () => {
    setToggling(true);
    const outcome = await requestPermission();
    if (outcome === 'granted') {
      setEnabled(true);
    }
    setBlocked(outcome === 'blocked');
    setToggling(false);
  }, [requestPermission, setEnabled]);

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
      <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
        <SwitchRow
          icon="bell-outline"
          title={t('notifications.settings.enable')}
          value={enabled}
          onValueChange={handleMainToggle}
          disabled={(!canEnable && !enabled) || toggling}
          testID="settings-notifications-toggle"
        />

        {notice ? (
          <View style={styles.notice}>
            <PermissionNotice
              testID="settings-notifications-blocked"
              outcome={notice}
              icon="bell-off-outline"
              reason={t('permissionNotice.notificationsOff')}
              onAllow={turnOnWithPermission}
            />
          </View>
        ) : null}

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
            accessibilityRole="link"
            accessibilityLabel={t('notifications.settings.privacyHint')}
            onPress={() => {
              void openExternal(VELOQ_PRIVACY_URL);
            }}
            style={pressable(styles.privacyRow)}
            android_ripple={pressRipple}
          >
            <Icon
              name="information-outline"
              size={iconSize.sm}
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
