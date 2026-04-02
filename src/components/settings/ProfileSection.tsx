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
  const grantedScopes = useUploadPermissionStore((s) => s.grantedScopes);
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

  /**
   * Parse OAuth scope string into display-friendly permission summary.
   * Input:  "ACTIVITY:WRITE,WELLNESS:READ,CALENDAR:READ,SETTINGS:READ"
   * Output: [{ label: "Activities", level: "read & write" }, { label: "Wellness", level: "read" }, ...]
   */
  const parseScopes = (
    scopes: string
  ): { label: string; level: 'read' | 'write' | 'read & write' }[] => {
    const categoryNames: Record<string, string> = {
      ACTIVITY: t('settings.activities', 'Activities'),
      WELLNESS: t('navigation.wellness', 'Wellness'),
      CALENDAR: t('navigation.training', 'Calendar'),
      SETTINGS: t('settings.title', 'Settings'),
      CHATS: 'Chats',
      LIBRARY: 'Library',
    };
    const map = new Map<string, Set<string>>();
    for (const s of scopes.split(',')) {
      const [cat, perm] = s.trim().split(':');
      if (!cat || !perm) continue;
      if (!map.has(cat)) map.set(cat, new Set());
      map.get(cat)!.add(perm.toUpperCase());
    }
    const result: { label: string; level: 'read' | 'write' | 'read & write' }[] = [];
    for (const [cat, perms] of map) {
      const label = categoryNames[cat] ?? cat.charAt(0) + cat.slice(1).toLowerCase();
      // WRITE implies READ per intervals.icu spec
      const hasWrite = perms.has('WRITE');
      const hasRead = perms.has('READ');
      const level = hasWrite ? 'read & write' : hasRead ? 'read' : 'read';
      result.push({ label, level });
    }
    return result;
  };

  const isDemo = authMethod === 'demo';
  const isOAuth = authMethod === 'oauth';
  const parsedScopes = isOAuth && grantedScopes ? parseScopes(grantedScopes) : [];
  // Show permission row for OAuth users without confirmed write permission
  const showPermissionRow = isOAuth && hasWritePermission !== true;

  return (
    <View testID="settings-profile-section" style={[styles.section, isDark && styles.sectionDark]}>
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
          {isOAuth && parsedScopes.length > 0 && (
            <View style={styles.scopeRow}>
              {parsedScopes.map((s) => (
                <View key={s.label} style={styles.scopeBadge}>
                  <MaterialCommunityIcons
                    name={s.level === 'read & write' ? 'pencil-outline' : 'eye-outline'}
                    size={10}
                    color={isDark ? '#999' : '#888'}
                  />
                  <Text style={[styles.scopeBadgeText, isDark && styles.textMuted]}>{s.label}</Text>
                </View>
              ))}
            </View>
          )}
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
  scopeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  scopeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: 'rgba(150, 150, 150, 0.12)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  scopeBadgeText: {
    fontSize: 11,
    color: colors.textSecondary,
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
