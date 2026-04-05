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
import { colors, darkColors, spacing, layout, typography } from '@/theme';
import { settingsStyles } from './settingsStyles';

export function NotificationSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const authMethod = useAuthStore((s) => s.authMethod);
  const isOAuth = authMethod === 'oauth';
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const { enabled, categories, setEnabled, setCategoryEnabled } = useNotificationPreferences();
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

        {/* Category toggles (only when enabled) */}
        {enabled ? (
          <>
            <View style={[settingsStyles.fullDivider, isDark && settingsStyles.fullDividerDark]} />
            <Text style={[styles.categoryHeader, isDark && settingsStyles.textMuted]}>
              {t('notifications.settings.categories')}
            </Text>

            <CategoryRow
              label={t('notifications.settings.sectionPr')}
              icon="trophy-outline"
              value={categories.sectionPr}
              onToggle={(v) => setCategoryEnabled('sectionPr', v)}
              isDark={isDark}
            />
            <CategoryRow
              label={t('notifications.settings.fitnessMilestone')}
              icon="lightning-bolt"
              value={categories.fitnessMilestone}
              onToggle={(v) => setCategoryEnabled('fitnessMilestone', v)}
              isDark={isDark}
            />
          </>
        ) : null}
      </View>
    </>
  );
}

function CategoryRow({
  label,
  icon,
  value,
  onToggle,
  isDark,
}: {
  label: string;
  icon: string;
  value: boolean;
  onToggle: (v: boolean) => void;
  isDark: boolean;
}) {
  return (
    <View style={styles.categoryRow}>
      <MaterialCommunityIcons
        name={icon as never}
        size={16}
        color={isDark ? darkColors.textSecondary : colors.textSecondary}
      />
      <Text style={[styles.categoryLabel, isDark && settingsStyles.textLight]} numberOfLines={1}>
        {label}
      </Text>
      <Switch value={value} onValueChange={onToggle} color={colors.primary} />
    </View>
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
  categoryHeader: {
    ...typography.captionBold,
    color: colors.textSecondary,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    gap: spacing.sm,
  },
  categoryLabel: {
    ...typography.bodySmall,
    flex: 1,
    color: colors.textPrimary,
  },
});
