import React from 'react';
import { View, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, spacing, layout, typography, brand } from '@/theme';

export interface SaveErrorBannerProps {
  /** Error text to display. If falsy, the banner renders nothing. */
  errorMessage: string | null | undefined;
  /** When true, show the "Grant Access" OAuth upgrade button */
  showPermissionFix: boolean;
  /** Spinner state for the upgrade button */
  isOAuthLoading: boolean;
  /** Invoked when the user taps "Grant Access" */
  onUpgradePermissions: () => void;
  /**
   * When provided, shows a "Retry" button for recoverable (server-rejected)
   * failures. Omitted for permission and network errors, which have their own
   * paths (OAuth upgrade / automatic queue).
   */
  onRetry?: () => void;
  /** Spinner state for the retry button */
  isRetrying?: boolean;
}

/**
 * Error banner shown when saving/uploading an activity fails.
 *
 * For 403 (permission) errors, the recorder sets `showPermissionFix` to true
 * and a secondary "Grant Access" button is shown that initiates an OAuth
 * upgrade flow via {@link SaveErrorBannerProps.onUpgradePermissions}.
 */
export function SaveErrorBanner({
  errorMessage,
  showPermissionFix,
  isOAuthLoading,
  onUpgradePermissions,
  onRetry,
  isRetrying = false,
}: SaveErrorBannerProps) {
  const { t } = useTranslation();

  if (!errorMessage) return null;

  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorBannerText}>{errorMessage}</Text>
      {showPermissionFix && (
        <TouchableOpacity
          style={[styles.oauthUpgradeBtn, { backgroundColor: brand.teal }]}
          onPress={onUpgradePermissions}
          disabled={isOAuthLoading}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={t('recording.grantAccess', 'Grant Access')}
        >
          {isOAuthLoading ? (
            <ActivityIndicator size="small" color={colors.textOnDark} />
          ) : (
            <>
              <MaterialCommunityIcons
                name="shield-lock-outline"
                size={16}
                color={colors.textOnDark}
              />
              <Text style={styles.oauthUpgradeBtnText}>
                {t('recording.grantAccess', 'Grant Access')}
              </Text>
            </>
          )}
        </TouchableOpacity>
      )}
      {!showPermissionFix && onRetry && (
        <TouchableOpacity
          style={[styles.oauthUpgradeBtn, { backgroundColor: brand.teal }]}
          onPress={onRetry}
          disabled={isRetrying}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={t('common.retry', 'Retry')}
        >
          {isRetrying ? (
            <ActivityIndicator size="small" color={colors.textOnDark} />
          ) : (
            <>
              <MaterialCommunityIcons name="refresh" size={16} color={colors.textOnDark} />
              <Text style={styles.oauthUpgradeBtnText}>{t('common.retry', 'Retry')}</Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  errorBanner: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderRadius: layout.borderRadiusSm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  errorBannerText: {
    ...typography.caption,
    color: colors.error,
    textAlign: 'center',
  },
  oauthUpgradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: layout.borderRadiusSm,
    minHeight: layout.minTapTarget,
  },
  oauthUpgradeBtnText: {
    ...typography.bodyBold,
    color: colors.textOnDark,
    fontSize: 14,
  },
});
