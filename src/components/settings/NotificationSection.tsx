import React, { useCallback, useEffect, useState } from 'react';
import { View, StyleSheet, Alert, Pressable } from 'react-native';
import { Text, Switch } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { useAuthStore, useNotificationPreferences } from '@/providers';
import {
  requestNotificationPermission,
  hasNotificationPermission,
} from '@/lib/notifications/notificationService';
import { colors, darkColors, spacing, layout } from '@/theme';
import { SectionDivider } from './SettingsSection';

function showPrivacyNotice(t: (key: string) => string): void {
  Alert.alert(t('notifications.privacy.title'), t('notifications.privacy.body'));
}

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

  // Sync with OS permission: if user revoked notification permission in system settings,
  // disable notifications in the app so the toggle reflects reality
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

      if (value && !privacyAccepted) {
        Alert.alert(t('notifications.privacy.title'), t('notifications.privacy.brief'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('notifications.privacy.accept'),
            onPress: async () => {
              acceptPrivacy();
              setToggling(true);
              const granted = await requestNotificationPermission();
              if (granted) {
                setEnabled(true);
              }
              setToggling(false);
            },
          },
        ]);
        return;
      }

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
    [canEnable, privacyAccepted, acceptPrivacy, setEnabled, t]
  );

  const handleShowPrivacy = useCallback(() => {
    showPrivacyNotice(t as (key: string) => string);
  }, [t]);

  return (
    <>
      <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
        {t('notifications.settings.title').toUpperCase()}
      </Text>
      <View style={[styles.section, isDark && styles.sectionDark]}>
        {/* Main toggle */}
        <View style={styles.row}>
          <MaterialCommunityIcons
            name="bell-outline"
            size={20}
            color={isDark ? darkColors.textPrimary : colors.textPrimary}
          />
          <Text style={[styles.rowLabel, isDark && styles.textLight]} numberOfLines={1}>
            {t('notifications.settings.enable')}
          </Text>
          {canEnable ? (
            <Pressable
              onPress={handleShowPrivacy}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.infoButton}
            >
              <MaterialCommunityIcons
                name="information-outline"
                size={18}
                color={isDark ? darkColors.textMuted : colors.textMuted}
              />
            </Pressable>
          ) : null}
          <Switch
            value={enabled}
            onValueChange={handleMainToggle}
            disabled={!canEnable || toggling}
            color={colors.primary}
          />
        </View>

        {!canEnable ? (
          <Text style={[styles.hint, isDark && styles.textMuted]}>
            {t('notifications.settings.requiresOAuth')}
          </Text>
        ) : null}

        {/* Category toggles (only when enabled) */}
        {enabled ? (
          <>
            <SectionDivider />
            <Text style={[styles.categoryHeader, isDark && styles.textMuted]}>
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
            <CategoryRow
              label={t('notifications.settings.periodComparison')}
              icon="chart-line"
              value={categories.periodComparison}
              onToggle={(v) => setCategoryEnabled('periodComparison', v)}
              isDark={isDark}
            />
            <CategoryRow
              label={t('notifications.settings.activityPattern')}
              icon="calendar-clock"
              value={categories.activityPattern}
              onToggle={(v) => setCategoryEnabled('activityPattern', v)}
              isDark={isDark}
            />

            <SectionDivider />
            <Text style={[styles.stravaNote, isDark && styles.textMuted]}>
              {t('notifications.settings.stravaNote')}
            </Text>
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
      <Text style={[styles.categoryLabel, isDark && styles.textLight]} numberOfLines={1}>
        {label}
      </Text>
      <Switch value={value} onValueChange={onToggle} color={colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.5,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginHorizontal: spacing.md,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  section: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    marginBottom: spacing.md,
    overflow: 'hidden',
  },
  sectionDark: {
    backgroundColor: darkColors.surface,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  rowLabel: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  infoButton: {
    padding: 4,
  },
  hint: {
    fontSize: 12,
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  categoryHeader: {
    fontSize: 12,
    fontWeight: '600',
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
    flex: 1,
    fontSize: 14,
    color: colors.textPrimary,
  },
  stravaNote: {
    fontSize: 12,
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontStyle: 'italic',
  },
});
