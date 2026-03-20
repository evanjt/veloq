import React from 'react';
import { View, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Text } from 'react-native-paper';
import { useTheme } from '@/hooks';
import { useTranslation } from 'react-i18next';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuthStore, useUploadPermissionStore } from '@/providers';
import { usePermissionUpgrade } from '@/hooks/recording/usePermissionUpgrade';
import { colors, darkColors, spacing, layout } from '@/theme';

export function RecordingPermissionSection() {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const authMethod = useAuthStore((s) => s.authMethod);
  const hasWritePermission = useUploadPermissionStore((s) => s.hasWritePermission);
  const { upgradePermissions, isUpgrading, error } = usePermissionUpgrade();

  // Only show when write permission is explicitly denied (OAuth without ACTIVITY:WRITE)
  // API key users always have full permissions, demo users don't upload
  if (authMethod === 'demo' || authMethod === 'apiKey') return null;
  // Don't show if permission state is unknown or granted
  if (hasWritePermission !== false) return null;

  const hasPermission = false;

  return (
    <>
      <Text style={[styles.sectionLabel, isDark && styles.textMuted]}>
        {t('settings.recording', 'Recording').toUpperCase()}
      </Text>
      <View style={[styles.section, isDark && styles.sectionDark]}>
        <View style={styles.row}>
          <MaterialCommunityIcons
            name={hasPermission ? 'check-circle-outline' : 'shield-alert-outline'}
            size={22}
            color={hasPermission ? '#22C55E' : '#F59E0B'}
          />
          <View style={styles.textContainer}>
            <Text style={[styles.statusText, isDark && styles.textLight]}>
              {hasPermission
                ? t('recording.writePermissionActive', 'Write permission active')
                : t('recording.writePermissionNotGranted', 'Write permission not granted')}
            </Text>
            {!hasPermission && (
              <Text style={[styles.description, isDark && styles.textMuted]}>
                {t(
                  'recording.writePermissionDescription',
                  "Your API key doesn't include write permission. Grant OAuth access to enable recording and uploads."
                )}
              </Text>
            )}
          </View>
          {!hasPermission && (
            <TouchableOpacity
              testID="settings-grant-access"
              style={styles.button}
              onPress={upgradePermissions}
              disabled={isUpgrading}
              activeOpacity={0.7}
            >
              {isUpgrading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.buttonText}>{t('recording.grantAccess', 'Grant Access')}</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
        {error ? (
          <Text style={styles.errorText} numberOfLines={2}>
            {error}
          </Text>
        ) : null}
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
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  sectionDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  textContainer: {
    flex: 1,
    gap: 4,
  },
  statusText: {
    fontSize: 15,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  description: {
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  button: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: '#F59E0B',
    minWidth: 80,
    alignItems: 'center',
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  errorText: {
    fontSize: 12,
    color: '#DC2626',
    marginTop: spacing.xs,
    marginLeft: 22 + spacing.sm,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: darkColors.textSecondary,
  },
});
