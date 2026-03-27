import React, { useCallback, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text, Switch } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/hooks';
import { useNotificationPreferences } from '@/providers/NotificationPreferencesStore';
import { useAuthStore } from '@/providers/AuthStore';
import { requestNotificationPermission } from '@/lib/notifications/notificationService';
import { colors, darkColors, spacing } from '@/theme';

const EXAMPLES = [
  { icon: 'trophy', color: '#D4AF37', titleKey: 'notifications.sectionPr.title' },
  { icon: 'lightning-bolt', color: '#66BB6A', titleKey: 'notifications.fitnessMilestone.title' },
  { icon: 'chart-line', color: '#42A5F5', titleKey: 'notifications.periodComparison.title' },
] as const;

/**
 * What's New slide that introduces push notifications.
 * Contains an inline toggle for enabling notifications with privacy consent.
 */
export function NotificationSlide() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const authMethod = useAuthStore((s) => s.authMethod);
  const isOAuth = authMethod === 'oauth';
  const { enabled, setEnabled } = useNotificationPreferences();
  const [toggling, setToggling] = useState(false);

  const handleToggle = useCallback(
    async (value: boolean) => {
      if (!isOAuth) return;

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
    [isOAuth, setEnabled]
  );

  return (
    <View style={styles.container}>
      {/* Notification preview mockups */}
      <View style={styles.previewContainer}>
        {EXAMPLES.map((example) => (
          <View
            key={example.titleKey}
            style={[styles.previewCard, isDark && styles.previewCardDark]}
          >
            <MaterialCommunityIcons name={example.icon as never} size={18} color={example.color} />
            <View style={styles.previewText}>
              <Text
                style={[styles.previewTitle, isDark && styles.previewTitleDark]}
                numberOfLines={1}
              >
                {t(example.titleKey)}
              </Text>
              <Text
                style={[styles.previewBody, isDark && styles.previewBodyDark]}
                numberOfLines={1}
              >
                {t(`whatsNew.v030.notificationExample.${example.icon}`)}
              </Text>
            </View>
          </View>
        ))}
      </View>

      {/* Toggle */}
      <View style={[styles.toggleRow, isDark && styles.toggleRowDark]}>
        <View style={styles.toggleLabel}>
          <MaterialCommunityIcons
            name="bell-outline"
            size={20}
            color={isDark ? darkColors.textPrimary : colors.textPrimary}
          />
          <Text style={[styles.toggleText, isDark && styles.toggleTextDark]}>
            {t('whatsNew.v030.enableNotifications')}
          </Text>
        </View>
        <Switch
          value={enabled}
          onValueChange={handleToggle}
          disabled={!isOAuth || toggling}
          color={colors.primary}
        />
      </View>

      {!isOAuth ? (
        <Text style={[styles.hint, isDark && styles.hintDark]}>
          {t('whatsNew.v030.requiresOAuth')}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    gap: spacing.md,
  },
  previewContainer: {
    gap: spacing.xs,
  },
  previewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  previewCardDark: {
    backgroundColor: darkColors.surfaceCard,
    borderColor: darkColors.border,
  },
  previewText: {
    flex: 1,
  },
  previewTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  previewTitleDark: {
    color: darkColors.textPrimary,
  },
  previewBody: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  previewBodyDark: {
    color: darkColors.textSecondary,
  },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  toggleRowDark: {
    backgroundColor: darkColors.surfaceCard,
    borderColor: darkColors.border,
  },
  toggleLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  toggleText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  toggleTextDark: {
    color: darkColors.textPrimary,
  },
  hint: {
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
  },
  hintDark: {
    color: darkColors.textMuted,
  },
});
