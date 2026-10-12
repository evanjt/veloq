import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useTheme } from '@/shared/app';
import { StatusLine } from '@/shared/ui/StatusLine';
import { spacing, typography, themePalette } from '@/theme';
import { usePermissionUpgrade } from '@/features/recording/hooks/usePermissionUpgrade';
import { useWriteAccessMissing } from '@/features/recording/hooks/useWriteAccessMissing';
import { GrantAccessButton } from './GrantAccessButton';

const ICON_SIZE = 22;

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
    <View testID="settings-upload-permission" style={styles.container}>
      <View style={styles.row}>
        <MaterialCommunityIcons
          name="shield-alert-outline"
          size={ICON_SIZE}
          color={palette.warningAmber}
        />
        <View style={styles.textContainer}>
          <Text style={[styles.statusText, { color: palette.textPrimary }]}>
            {t('recording.writePermissionNotGranted', 'Write permission not granted')}
          </Text>
          <Text style={[styles.description, { color: palette.textSecondary }]}>
            {t(
              'recording.uploadsWaitForAccess',
              'Uploads wait until you grant access. Recordings stay on this device until then.'
            )}
          </Text>
        </View>
        <GrantAccessButton
          testID="settings-grant-access"
          onPress={upgradePermissions}
          loading={isUpgrading}
          small
        />
      </View>
      {error ? (
        <StatusLine tone="error" message={error}>
          <Text style={[styles.errorText, { color: palette.errorDeep }]} numberOfLines={2}>
            {error}
          </Text>
        </StatusLine>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  textContainer: {
    flex: 1,
    gap: spacing.xs,
  },
  statusText: {
    ...typography.body,
  },
  description: {
    ...typography.bodyCompact,
  },
  errorText: {
    ...typography.caption,
    marginTop: spacing.xs,
    marginLeft: ICON_SIZE + spacing.sm,
  },
});
