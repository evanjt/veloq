import React from 'react';
import { StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { InlineNotice } from '@/shared/ui/InlineNotice';
import { StatusLine } from '@/shared/ui/StatusLine';
import { spacing, themePalette, typography } from '@/theme';
import { usePermissionUpgrade } from '@/features/recording/hooks/usePermissionUpgrade';
import { useWriteAccessMissing } from '@/features/recording/hooks/useWriteAccessMissing';
import { GrantAccessButton } from './GrantAccessButton';

/**
 * The write-permission state beside the upload setting it decides, with the
 * control that grants it. Renders nothing when uploads can go through.
 */
export function UploadPermissionNotice() {
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const { t } = useTranslation();
  const missing = useWriteAccessMissing();
  const { upgradePermissions, isUpgrading, error } = usePermissionUpgrade();

  if (!missing) return null;

  return (
    <InlineNotice
      testID="settings-upload-permission"
      tone="warning"
      icon="shield-alert-outline"
      title={t('recording.writePermissionNotGranted', 'Write permission not granted')}
      detail={t(
        'recording.uploadsWaitForAccess',
        'Uploads wait until you grant access. Recordings stay on this device until then.'
      )}
      action={
        <GrantAccessButton
          testID="settings-grant-access"
          onPress={upgradePermissions}
          loading={isUpgrading}
          small
        />
      }
      style={styles.container}
    >
      {error ? (
        <StatusLine tone="error" message={error}>
          <Text style={[styles.errorText, { color: palette.errorText }]} numberOfLines={2}>
            {error}
          </Text>
        </StatusLine>
      ) : null}
    </InlineNotice>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.sm,
  },
  errorText: {
    ...typography.caption,
  },
});
