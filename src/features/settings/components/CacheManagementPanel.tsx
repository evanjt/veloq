import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing } from '@/theme';

export interface CacheManagementPanelProps {
  isDark: boolean;
  isDemoMode: boolean;
  routeMatchingEnabled: boolean;
  isRouteProcessing: boolean;
  onCancelRouteProcessing: () => void;
  onClearCache: () => void;
}

export function CacheManagementPanel({
  isDark,
  isDemoMode,
  routeMatchingEnabled,
  isRouteProcessing,
  onCancelRouteProcessing,
  onClearCache,
}: CacheManagementPanelProps) {
  const { t } = useTranslation();

  return (
    <>
      {routeMatchingEnabled && isRouteProcessing && (
        <>
          <TouchableOpacity style={styles.actionRow} onPress={onCancelRouteProcessing}>
            <MaterialCommunityIcons name="pause-circle-outline" size={22} color={colors.warning} />
            <Text style={[styles.actionText, isDark && styles.textLight]}>
              {t('settings.pauseRouteProcessing')}
            </Text>
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color={isDark ? darkColors.textMuted : colors.textSecondary}
            />
          </TouchableOpacity>
          <View style={[styles.divider, isDark && styles.dividerDark]} />
        </>
      )}

      <TouchableOpacity
        testID="settings-clear-cache"
        style={[styles.actionRow, isDemoMode && styles.actionRowDisabled]}
        onPress={isDemoMode ? undefined : onClearCache}
        disabled={isDemoMode}
        activeOpacity={isDemoMode ? 1 : 0.2}
      >
        <MaterialCommunityIcons
          name="delete-outline"
          size={22}
          color={isDemoMode ? colors.textSecondary : colors.error}
        />
        <Text
          style={[
            styles.actionText,
            isDemoMode ? styles.actionTextDisabled : styles.actionTextDanger,
          ]}
        >
          {t('settings.clearAllReload')}
        </Text>
        <MaterialCommunityIcons
          name="chevron-right"
          size={20}
          color={isDark ? darkColors.textMuted : colors.textSecondary}
        />
      </TouchableOpacity>
    </>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  actionRowDisabled: {
    opacity: 0.5,
  },
  actionText: {
    flex: 1,
    fontSize: 16,
    color: colors.textPrimary,
  },
  actionTextDisabled: {
    color: colors.textSecondary,
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
});
