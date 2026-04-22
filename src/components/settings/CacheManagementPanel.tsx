import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing } from '@/theme';

interface RescanProgress {
  phase: string;
  completed: number;
  total: number;
}

export interface CacheManagementPanelProps {
  isDark: boolean;
  isDemoMode: boolean;
  /** Route processing */
  routeMatchingEnabled: boolean;
  isRouteProcessing: boolean;
  onCancelRouteProcessing: () => void;
  /** Section re-detection */
  isRescanning: boolean;
  rescanProgress: RescanProgress | null;
  onRescanSections: () => void;
  /** Clear cache */
  onClearCache: () => void;
}

export function CacheManagementPanel({
  isDark,
  isDemoMode,
  routeMatchingEnabled,
  isRouteProcessing,
  onCancelRouteProcessing,
  isRescanning,
  rescanProgress,
  onRescanSections,
  onClearCache,
}: CacheManagementPanelProps) {
  const { t } = useTranslation();
  const rescanDisabled = isDemoMode || !routeMatchingEnabled || isRouteProcessing;

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
        testID="settings-rescan-sections"
        style={[styles.actionRow, rescanDisabled && styles.actionRowDisabled]}
        onPress={rescanDisabled || isRescanning ? undefined : onRescanSections}
        disabled={rescanDisabled || isRescanning}
        activeOpacity={rescanDisabled || isRescanning ? 1 : 0.2}
      >
        {isRescanning ? (
          <ActivityIndicator size="small" color={colors.primary} style={styles.rescanSpinner} />
        ) : (
          <MaterialCommunityIcons
            name="refresh"
            size={22}
            color={rescanDisabled ? colors.textSecondary : colors.primary}
          />
        )}
        <View style={styles.rescanTextContainer}>
          <Text
            style={[
              styles.actionText,
              rescanDisabled ? styles.actionTextDisabled : isDark && styles.textLight,
            ]}
          >
            {t('settings.redetectSections')}
          </Text>
          {isRescanning && rescanProgress ? (
            <Text style={[styles.rescanProgressText, isDark && styles.rescanProgressTextDark]}>
              {rescanProgress.phase}
              {rescanProgress.total > 0
                ? ` ${rescanProgress.completed}/${rescanProgress.total}`
                : ''}
            </Text>
          ) : (
            <Text style={[styles.rescanHint, isDark && styles.rescanHintDark]}>
              {t('settings.redetectSectionsHint')}
            </Text>
          )}
        </View>
        {!isRescanning && (
          <MaterialCommunityIcons
            name="chevron-right"
            size={20}
            color={isDark ? darkColors.textMuted : colors.textSecondary}
          />
        )}
      </TouchableOpacity>

      <View style={[styles.divider, isDark && styles.dividerDark]} />

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
    marginLeft: spacing.md + 22 + spacing.sm, // icon + gap
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
  rescanSpinner: {
    width: 22,
    height: 22,
  },
  rescanTextContainer: {
    flex: 1,
  },
  rescanHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  rescanHintDark: {
    color: darkColors.textSecondary,
  },
  rescanProgressText: {
    fontSize: 12,
    color: colors.primary,
    marginTop: 2,
  },
  rescanProgressTextDark: {
    color: colors.primary,
  },
});
