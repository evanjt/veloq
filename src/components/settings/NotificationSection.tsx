import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Linking, Pressable } from 'react-native';
import { Text, Switch } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { useAuthStore, useNotificationPreferences } from '@/providers';
import {
  requestNotificationPermission,
  hasNotificationPermission,
} from '@/lib/notifications/notificationService';
import { colors, darkColors, spacing, typography } from '@/theme';
import { settingsStyles } from './settingsStyles';

export function NotificationSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const authMethod = useAuthStore((s) => s.authMethod);
  const isOAuth = authMethod === 'oauth';
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const { enabled, setEnabled } = useNotificationPreferences();
  const [toggling, setToggling] = useState(false);

  const canEnable = isOAuth && !isDemoMode;

  // Sync with OS permission
  useEffect(() => {
    if (enabled) {
      hasNotificationPermission().then((granted) => {
        if (!granted) {
          setEnabled(false);
        }
      });
    }
  }, [enabled, setEnabled]);

  const handleMainToggle = useCallback(
    async (value: boolean) => {
      if (!canEnable) return;

      if (value) {
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
    [canEnable, setEnabled]
  );

  return (
    <>
      <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
        {t('notifications.settings.title').toUpperCase()}
      </Text>
      <View style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}>
        {/* Main toggle */}
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

        {/* Category toggles hidden until background notifications are implemented.
           Store and filtering logic retained in NotificationPreferencesStore +
           insightNotification.ts — re-enable these rows when background push is live. */}
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
});
