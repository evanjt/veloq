import React, { useCallback, useEffect, useState } from 'react';
import { Alert, View, StyleSheet, Linking, Pressable } from 'react-native';
import { Text, Switch } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import {
  requestNotificationPermission,
  hasNotificationPermission,
} from '@/features/settings/lib/notificationService';
import { colors, darkColors, spacing, typography } from '@/theme';
import { settingsStyles } from './settingsStyles';
import { ListSectionHeader, pressable, pressRipple } from '@/shared/ui';

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
    acceptPrivacy();
    setToggling(true);
    const granted = await requestNotificationPermission();
    if (granted) {
      setEnabled(true);
    }
    setToggling(false);
  }, [acceptPrivacy, setEnabled]);

  // The notice that has to be read before a push token leaves the device: it
  // names what is stored on the server and who routes the notification.
  // Dismissing it, by the back gesture or a tap outside, is a decline.
  const showPrivacyNotice = useCallback(() => {
    Alert.alert(
      t('notifications.privacy.title'),
      t('notifications.privacy.brief'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('notifications.privacy.accept'), onPress: handlePrivacyAccept },
      ],
      { cancelable: true }
    );
  }, [t, handlePrivacyAccept]);

  const handleMainToggle = useCallback(
    async (value: boolean) => {
      if (!canEnable) return;

      if (value) {
        if (!privacyAccepted) {
          showPrivacyNotice();
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
    [canEnable, privacyAccepted, setEnabled, showPrivacyNotice]
  );

  return (
    <>
      <ListSectionHeader>{t('notifications.settings.title')}</ListSectionHeader>
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
            disabled={(!canEnable && !enabled) || toggling}
            color={colors.primary}
            testID="settings-notifications-toggle"
          />
        </View>

        {CATEGORIES.map((category) => (
          <View key={category.id} style={[styles.row, styles.categoryRow]}>
            <Text style={[styles.rowLabel, isDark && settingsStyles.textLight]} numberOfLines={1}>
              {t(category.label)}
            </Text>
            <Switch
              value={categories[category.id]}
              onValueChange={(next) => setCategoryEnabled(category.id, next)}
              // A switch that can be moved while notifications are off promises
              // a push that will not arrive.
              disabled={!enabled || !canEnable || toggling}
              color={colors.primary}
              testID={`settings-notifications-${category.id}`}
            />
          </View>
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  categoryRow: {
    // Indented under the switch that governs them.
    paddingLeft: spacing.xl,
    paddingVertical: spacing.xs,
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
    color: colors.textSecondary,
    textTransform: 'none',
  },
});
