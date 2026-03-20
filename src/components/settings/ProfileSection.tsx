import React, { useState, memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ActivityIndicator } from 'react-native';
import { useTheme } from '@/hooks';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { colors, darkColors, spacing } from '@/theme';
import { getAthleteId } from '@/api';
import { useAuthStore, useUploadPermissionStore } from '@/providers';
import { usePermissionUpgrade } from '@/hooks/recording/usePermissionUpgrade';
import { useTranslation } from 'react-i18next';

interface Athlete {
  name?: string;
  profile?: string;
  profile_medium?: string;
}

interface ProfileSectionProps {
  athlete?: Athlete;
}

function ProfileSectionComponent({ athlete }: ProfileSectionProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const [profileImageError, setProfileImageError] = useState(false);
  const authMethod = useAuthStore((state) => state.authMethod);
  const hasWritePermission = useUploadPermissionStore((s) => s.hasWritePermission);
  const { upgradePermissions, isUpgrading, error: upgradeError } = usePermissionUpgrade();

  const profileUrl = athlete?.profile_medium || athlete?.profile;
  const hasValidProfileUrl =
    profileUrl && typeof profileUrl === 'string' && profileUrl.startsWith('http');

  // Get auth method badge text
  const getAuthBadge = (): string => {
    switch (authMethod) {
      case 'oauth':
        return 'OAuth';
      case 'apiKey':
        return 'API key';
      case 'demo':
        return 'Demo mode';
      default:
        return '';
    }
  };

  const isDemo = authMethod === 'demo';
  // Show permission row for OAuth users without confirmed write permission
  const showPermissionRow = authMethod === 'oauth' && hasWritePermission !== true;

  return (
    <View style={[styles.section, isDark && styles.sectionDark]}>
      <TouchableOpacity
        style={styles.profileRow}
        onPress={
          isDemo
            ? undefined
            : () =>
                WebBrowser.openBrowserAsync(
                  `https://intervals.icu/athlete/${getAthleteId()}/activities`
                )
        }
        activeOpacity={isDemo ? 1 : 0.7}
        disabled={isDemo}
      >
        <View style={[styles.profilePhoto, isDark && styles.profilePhotoDark]}>
          {hasValidProfileUrl && !profileImageError ? (
            <Image
              source={{ uri: profileUrl }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              onError={() => setProfileImageError(true)}
            />
          ) : (
            <MaterialCommunityIcons name="account" size={32} color={isDark ? '#AAA' : '#666'} />
          )}
        </View>
        <View style={styles.profileInfo}>
          <Text style={[styles.profileName, isDark && styles.textLight]}>
            {athlete?.name || 'Athlete'}
          </Text>
          <Text style={[styles.profileEmail, isDark && styles.textMuted]}>
            {authMethod === 'demo' ? getAuthBadge() : `intervals.icu · ${getAuthBadge()}`}
          </Text>
        </View>
        {!isDemo && (
          <MaterialCommunityIcons
            name="chevron-right"
            size={24}
            color={isDark ? darkColors.textMuted : colors.textSecondary}
          />
        )}
      </TouchableOpacity>

      {showPermissionRow && (
        <>
          <View style={[styles.divider, isDark && styles.dividerDark]} />
          <View style={styles.permissionRow}>
            <MaterialCommunityIcons name="shield-alert-outline" size={20} color="#F59E0B" />
            <Text style={[styles.permissionText, isDark && styles.textMuted]} numberOfLines={2}>
              {t('recording.writePermissionNotGranted', 'Write permission not granted')}
            </Text>
            <TouchableOpacity
              testID="settings-grant-access"
              style={styles.permissionButton}
              onPress={upgradePermissions}
              disabled={isUpgrading}
              activeOpacity={0.7}
            >
              {isUpgrading ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Text style={styles.permissionButtonText}>
                  {t('recording.grantAccess', 'Grant Access')}
                </Text>
              )}
            </TouchableOpacity>
          </View>
          {upgradeError ? (
            <Text style={styles.upgradeError} numberOfLines={2}>
              {upgradeError}
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}

// Memoize to prevent re-renders when parent re-renders
export const ProfileSection = memo(ProfileSectionComponent);

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: spacing.sm,
    overflow: 'hidden',
  },
  sectionDark: {
    backgroundColor: darkColors.surface,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
  },
  profilePhoto: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  profilePhotoDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    fontSize: 17,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  profileEmail: {
    fontSize: 14,
    color: colors.textSecondary,
    marginTop: 2,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginHorizontal: spacing.md,
  },
  dividerDark: {
    backgroundColor: darkColors.border,
  },
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 2,
    gap: spacing.sm,
  },
  permissionText: {
    flex: 1,
    fontSize: 14,
    color: colors.textSecondary,
  },
  permissionButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#F59E0B',
    minWidth: 80,
    alignItems: 'center',
  },
  permissionButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  upgradeError: {
    fontSize: 12,
    color: '#DC2626',
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    marginLeft: 20 + spacing.sm,
  },
  textLight: {
    color: colors.textOnDark,
  },
  textMuted: {
    color: colors.textSecondary,
  },
});
