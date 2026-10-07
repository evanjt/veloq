import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Linking, Pressable } from 'react-native';
import { Text, Switch } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useNotificationPreferences } from '@/features/settings/stores/NotificationPreferencesStore';
import { NotificationPrivacyDialog } from './NotificationPrivacyDialog';
import {
  requestNotificationPermission,
  hasNotificationPermission,
} from '@/features/settings/lib/notificationService';
import { colors, darkColors, spacing, typography } from '@/theme';
import { settingsStyles } from './settingsStyles';
import { pressable, pressRipple } from '@/shared/ui';

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
            style={[settingsStyles.hintText, isDark && settingsStyles.textMuted]}
          >
            {t('notifications.settings.requiresOAuth')}
          </Text>
        ) : (
          <Pressable
            onPress={() => Linking.openURL('https://veloq.fit/privacy')}
            style={pressable(styles.privacyRow)}
            android_ripple={pressRipple}
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

      <NotificationPrivacyDialog
        visible={showPrivacyDialog}
        onCancel={() => setShowPrivacyDialog(false)}
        onAccept={handlePrivacyAccept}
      />
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
    color: colors.textMuted,
    textTransform: 'none',
  },
});
