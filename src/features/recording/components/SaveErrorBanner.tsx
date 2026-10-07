import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { colors, colorWithOpacity, darkColors, spacing, layout, typography } from '@/theme';
import { useTheme } from '@/shared/app';
import { Button } from '@/shared/ui/Button';
import { useAnnounceOnAppear } from '@/shared/ui/useAnnounceOnAppear';
import { GrantAccessButton } from './GrantAccessButton';

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
  onRetry?: (() => void) | undefined;
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
  const { isDark } = useTheme();

  useAnnounceOnAppear(errorMessage);

  if (!errorMessage) return null;

  return (
    <View style={styles.errorBanner} accessibilityLiveRegion="assertive">
      <Text style={[styles.errorBannerText, isDark && styles.errorBannerTextDark]}>
        {errorMessage}
      </Text>
      {showPermissionFix && (
        <GrantAccessButton onPress={onUpgradePermissions} loading={isOAuthLoading} />
      )}
      {!showPermissionFix && onRetry && (
        <Button
          style={styles.retryButton}
          label={t('common.retry', 'Retry')}
          onPress={onRetry}
          loading={isRetrying}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  errorBanner: {
    backgroundColor: colorWithOpacity(colors.error, 0.1),
    borderRadius: layout.borderRadiusSm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  errorBannerText: {
    ...typography.caption,
    color: colors.errorDeep,
    textAlign: 'center',
  },
  errorBannerTextDark: {
    color: darkColors.errorDeep,
  },
  retryButton: {
    marginTop: spacing.sm,
  },
});
