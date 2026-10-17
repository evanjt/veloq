import React, { useRef } from 'react';
import { StyleSheet, type ViewInstance } from 'react-native';
import { useTranslation } from 'react-i18next';

import { spacing } from '@/theme';
import { Button } from '@/shared/ui/Button';
import { InlineNotice } from '@/shared/ui/InlineNotice';
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
  /** Takes the share button, which the share sheet points at on iPad. */
  onShareFit?: ((anchor: React.RefObject<ViewInstance | null>) => void) | undefined;
  /**
   * When provided, shows a "Free up space" button beside Retry, for a save
   * that failed on a device short of space.
   */
  onFreeSpace?: (() => void) | undefined;
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
  onFreeSpace,
}: SaveErrorBannerProps) {
  const { t } = useTranslation();
  const shareAnchor = useRef<ViewInstance>(null);

  if (!errorMessage) return null;

  return (
    <InlineNotice
      testID="save-error-banner"
      tone="error"
      icon="alert-circle-outline"
      title={errorMessage}
      detail={detail}
      style={styles.banner}
    >
      {showPermissionFix ? (
        <GrantAccessButton onPress={onUpgradePermissions} loading={isOAuthLoading} />
      ) : null}
      {!showPermissionFix && onFreeSpace ? (
        <Button variant="secondary" label={t('common.freeUpSpace')} onPress={onFreeSpace} />
      ) : null}
      {!showPermissionFix && onRetry ? (
        <Button label={t('common.retry', 'Retry')} onPress={onRetry} loading={isRetrying} />
      ) : null}
      {onOpenRecording ? (
        <Button
          testID="save-error-open-recording"
          label={t('recording.openInRecordings', 'Open my recordings')}
          onPress={onOpenRecording}
        />
      ) : null}
      {onShareFit ? (
        <Button
          ref={shareAnchor}
          testID="save-error-share-fit"
          variant="secondary"
          label={t('recording.library.share', 'Share FIT file')}
          onPress={() => onShareFit(shareAnchor)}
        />
      ) : null}
    </InlineNotice>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginTop: spacing.sm,
  },
});
