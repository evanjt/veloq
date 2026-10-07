import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { useTheme } from '@/shared/app';
import { useAuthStore } from '@/shared/app/AuthStore';
import {
  useUploadPermissionStore,
  usePermissionUpgrade,
  GrantAccessButton,
} from '@/features/recording';
import { colors, darkColors, spacing, typography } from '@/theme';
import { settingsStyles } from './settingsStyles';

/**
 * The permanent home for the write-permission upgrade. The recordings-library
 * banner can be dismissed, so this is the only affordance that survives it.
 * API-key sign-ins carry every permission, and a demo athlete never uploads.
 */
export function RecordingPermissionSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const authMethod = useAuthStore((s) => s.authMethod);
  const hasWritePermission = useUploadPermissionStore((s) => s.hasWritePermission);
  const isLoaded = useUploadPermissionStore((s) => s.isLoaded);
  const { upgradePermissions, isUpgrading, error } = usePermissionUpgrade();

  if (!isLoaded || authMethod !== 'oauth' || hasWritePermission === true) return null;

  return (
    <>
      <Text style={[settingsStyles.sectionLabel, isDark && settingsStyles.textMuted]}>
        {t('settings.recording', 'Recording').toUpperCase()}
      </Text>
      <View
        style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark, styles.card]}
      >
        <View style={styles.row}>
          <MaterialCommunityIcons
            name="shield-alert-outline"
            size={22}
            color={isDark ? darkColors.warningAmber : colors.warningAmber}
          />
          <View style={styles.textContainer}>
            <Text style={[styles.statusText, isDark && settingsStyles.textLight]}>
              {t('recording.writePermissionNotGranted', 'Write permission not granted')}
            </Text>
            <Text style={[styles.description, isDark && settingsStyles.textMuted]}>
              {t(
                'recording.writePermissionLocalOnly',
                'Recording works without it. The ride stays on this device until you grant upload access.'
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
          <Text style={[styles.errorText, isDark && styles.errorTextDark]} numberOfLines={2}>
            {error}
          </Text>
        ) : null}
      </View>
    </>
  );
}

const PERMISSION_ICON_WIDTH = 22;

const styles = StyleSheet.create({
  card: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
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
    color: colors.textPrimary,
  },
  description: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
  },
  errorText: {
    ...typography.caption,
    color: colors.errorDeep,
    marginTop: spacing.xs,
    marginLeft: PERMISSION_ICON_WIDTH + spacing.sm,
  },
  errorTextDark: {
    color: darkColors.errorDeep,
  },
});
