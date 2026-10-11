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
  /** The server's own words behind the failure, shown smaller beneath the message. */
  detail?: string | null | undefined;
  /** When true, show the "Grant Access" OAuth upgrade button */
  showPermissionFix: boolean;
  /** Spinner state for the upgrade button */
  isOAuthLoading: boolean;
  /** Invoked when the user taps "Grant Access" */
  onUpgradePermissions: () => void;
  /**
   * When provided, shows a "Retry" button for a failure the same attempt can
   * get past. Omitted for a refusal, a missing file, and permission and network
   * errors, which have their own paths (kept ride / OAuth upgrade / automatic queue).
   */
  onRetry?: (() => void) | undefined;
  /** Spinner state for the retry button */
  isRetrying?: boolean;
  /** When provided, offers to open the kept ride in My Recordings. */
  onOpenRecording?: (() => void) | undefined;
  /** When provided, offers to share the kept ride's FIT file. */
  onShareFit?: (() => void) | undefined;
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
  detail,
  showPermissionFix,
  isOAuthLoading,
  onUpgradePermissions,
  onRetry,
  isRetrying = false,
  onOpenRecording,
  onShareFit,
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
      {!!detail && (
        <Text style={[styles.detailText, isDark && styles.detailTextDark]}>{detail}</Text>
      )}
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
      {onOpenRecording && (
        <Button
          testID="save-error-open-recording"
          style={styles.retryButton}
          label={t('recording.openInRecordings', 'Open in My Recordings')}
          onPress={onOpenRecording}
        />
      )}
      {onShareFit && (
        <Button
          testID="save-error-share-fit"
          style={styles.retryButton}
          variant="secondary"
          label={t('recording.library.share', 'Share FIT file')}
          onPress={onShareFit}
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
  detailText: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
  detailTextDark: {
    color: darkColors.textSecondary,
  },
  retryButton: {
    marginTop: spacing.sm,
  },
});
