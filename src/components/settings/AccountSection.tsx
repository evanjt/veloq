import React from 'react';
import { View, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/hooks';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/providers';
import { useSyncDateRange } from '@/providers/SyncDateRangeStore';
import { clearAllAppCaches } from '@/lib';
import { colors, darkColors, spacing, layout } from '@/theme';

export function AccountSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const clearCredentials = useAuthStore((s) => s.clearCredentials);
  const resetSyncDateRange = useSyncDateRange((s) => s.reset);

  const handleLogout = () => {
    Alert.alert(t('alerts.disconnectTitle'), t('alerts.disconnectMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('alerts.disconnect'),
        style: 'destructive',
        onPress: async () => {
          try {
            await clearCredentials();
            await queryClient.cancelQueries();
            await clearAllAppCaches(queryClient);
            resetSyncDateRange();
            router.replace('/login' as Href);
          } catch {
            Alert.alert(t('alerts.error'), t('alerts.failedToDisconnect'));
          }
        },
      },
    ]);
  };

  return (
    <>
      <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
        {t('settings.account').toUpperCase()}
      </Text>
      <View style={[styles.section, isDark && styles.sectionDark]}>
        <TouchableOpacity style={styles.actionRow} onPress={() => router.push('/about' as Href)}>
          <MaterialCommunityIcons name="information-outline" size={22} color={colors.primary} />
          <Text style={[styles.actionText, isDark && styles.textLight]}>{t('about.title')}</Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color={isDark ? darkColors.textMuted : colors.textSecondary}
          />
        </TouchableOpacity>

        <View style={[styles.divider, isDark && styles.dividerDark]} />

        <TouchableOpacity
          testID="settings-logout-button"
          style={styles.actionRow}
          onPress={handleLogout}
        >
          <MaterialCommunityIcons name="logout" size={22} color={colors.error} />
          <Text style={[styles.actionText, styles.actionTextDanger]}>
            {t('settings.disconnectAccount')}
          </Text>
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color={isDark ? darkColors.textMuted : colors.textSecondary}
          />
        </TouchableOpacity>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  sectionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textSecondary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    marginHorizontal: layout.screenPadding,
    letterSpacing: 0.5,
  },
  section: {
    backgroundColor: colors.surface,
    marginHorizontal: layout.screenPadding,
    borderRadius: 12,
    overflow: 'hidden',
  },
  sectionDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  actionText: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  actionTextDanger: {
    color: colors.error,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginLeft: spacing.md + 22 + spacing.sm,
  },
  dividerDark: {
    backgroundColor: darkColors.border,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});
