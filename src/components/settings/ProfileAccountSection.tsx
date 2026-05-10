import React, { useState, memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Alert } from 'react-native';
import { useTheme } from '@/hooks';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';
import { useQueryClient } from '@tanstack/react-query';
import { colors, darkColors, spacing, typography } from '@/theme';
import { getAthleteId } from '@/api';
import { useAuthStore, useUploadPermissionStore } from '@/providers';
import { useSyncDateRange } from '@/providers/SyncDateRangeStore';
import { clearAccountData, clearAuthOnly } from '@/lib/storage';
import { clearUploadQueue } from '@/lib/storage/uploadQueue';
import { useTranslation } from 'react-i18next';
import { settingsStyles } from './settingsStyles';

interface Athlete {
  name?: string;
  profile?: string;
  profile_medium?: string;
}

interface ProfileAccountSectionProps {
  athlete?: Athlete;
}

function ProfileAccountSectionComponent({ athlete }: ProfileAccountSectionProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();
  const [profileImageError, setProfileImageError] = useState(false);
  const authMethod = useAuthStore((state) => state.authMethod);
  const grantedScopes = useUploadPermissionStore((s) => s.grantedScopes);

  // Logout logic (moved from AccountSection)
  const queryClient = useQueryClient();
  const clearCredentials = useAuthStore((s) => s.clearCredentials);
  const resetSyncDateRange = useSyncDateRange((s) => s.reset);

  const finishLogout = async (clearAll: boolean) => {
    try {
      // Cancel in-flight queries first to prevent re-fetches during teardown
      await queryClient.cancelQueries();
      if (clearAll) {
        await clearAccountData(queryClient);
      } else {
        await clearAuthOnly(queryClient);
      }
      await clearUploadQueue();
      resetSyncDateRange();
      useUploadPermissionStore.getState().reset();
      // Clear credentials last — AuthGate detects isAuthenticated=false and
      // navigates to /login via InteractionManager to avoid an Android crash.
      await clearCredentials();
    } catch {
      Alert.alert(t('alerts.error'), t('alerts.failedToDisconnect'));
    }
  };

  // Plain "Sign out" — keep cached activities/GPS/sections so re-login on the
  // same account is instant. Only the auth credentials and the per-user
  // profile blobs (athlete photo, sport settings) are dropped.
  const handleLogout = () => {
    Alert.alert(t('alerts.disconnectTitle'), t('alerts.disconnectMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('alerts.disconnect'),
        style: 'destructive',
        onPress: () => finishLogout(false),
      },
    ]);
  };

  // Destructive option — wipe everything. For switching to a different
  // account, freeing storage, or starting clean.
  const handleLogoutAndClearData = () => {
    Alert.alert(
      t('alerts.disconnectAndClearTitle', { defaultValue: 'Sign out and delete data?' }),
      t('alerts.disconnectAndClearMessage', {
        defaultValue:
          'This signs you out AND deletes all cached activities, GPS tracks, sections, and route data on this device. The data will be re-synced from intervals.icu the next time you sign in. This cannot be undone.',
      }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('alerts.disconnectAndClearConfirm', { defaultValue: 'Delete and sign out' }),
          style: 'destructive',
          onPress: () => finishLogout(true),
        },
      ]
    );
  };

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
   * Output: [{ label: "Activities", level: "Write" }, { label: "Wellness", level: "Read" }, ...]
   */
  const parseScopes = (scopes: string): { label: string; level: string }[] => {
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
    const result: { label: string; level: string }[] = [];
    for (const [cat, perms] of map) {
      const label = categoryNames[cat] ?? cat.charAt(0) + cat.slice(1).toLowerCase();
      // WRITE implies READ per intervals.icu spec
      const hasWrite = perms.has('WRITE');
      const level = hasWrite ? 'Write' : 'Read';
      result.push({ label, level });
    }
    return result;
  };

  const isDemo = authMethod === 'demo';
  const isOAuth = authMethod === 'oauth';
  const parsedScopes = isOAuth && grantedScopes ? parseScopes(grantedScopes) : [];
  return (
    <View
      testID="settings-profile-section"
      style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}
    >
      {/* Profile row */}
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
            <MaterialCommunityIcons
              name="account"
              size={32}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
            />
          )}
        </View>
        <View style={styles.profileInfo}>
          <Text style={[styles.profileName, isDark && settingsStyles.textLight]}>
            {athlete?.name || 'Athlete'}
          </Text>
          <Text style={[styles.profileEmail, isDark && settingsStyles.textMuted]}>
            {authMethod === 'demo' ? getAuthBadge() : `intervals.icu · ${getAuthBadge()}`}
          </Text>
          {isOAuth && parsedScopes.length > 0 && (
            <View style={styles.scopeContainer}>
              <Text style={[styles.scopeTitle, isDark && settingsStyles.textMuted]}>
                {t('settings.permissions', 'Permissions')}
              </Text>
              <View style={styles.scopeRow}>
                {parsedScopes.map((s) => (
                  <View
                    key={s.label}
                    style={[settingsStyles.scopeBadge, isDark && settingsStyles.scopeBadgeDark]}
                  >
                    <Text
                      style={[settingsStyles.scopeBadgeText, isDark && settingsStyles.textMuted]}
                    >
                      {s.label}: {s.level}
                    </Text>
                  </View>
                ))}
              </View>
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

      {/* Logout row — keeps cached data for instant re-login */}
      <View style={[settingsStyles.rowDivider, isDark && settingsStyles.rowDividerDark]} />
      <TouchableOpacity
        testID="settings-logout-button"
        style={settingsStyles.actionRow}
        onPress={handleLogout}
      >
        <MaterialCommunityIcons name="logout" size={22} color={colors.error} />
        <Text style={[settingsStyles.actionRowText, { color: colors.error }]}>
          {t('settings.disconnectAccount')}
        </Text>
        <MaterialCommunityIcons
          name="chevron-right"
          size={20}
          color={isDark ? darkColors.textMuted : colors.textSecondary}
        />
      </TouchableOpacity>

      {/* Destructive sign-out — wipes activities/GPS/sections too */}
      {!isDemo && (
        <>
          <View style={[settingsStyles.rowDivider, isDark && settingsStyles.rowDividerDark]} />
          <TouchableOpacity
            testID="settings-logout-clear-button"
            style={settingsStyles.actionRow}
            onPress={handleLogoutAndClearData}
          >
            <MaterialCommunityIcons name="delete-forever" size={22} color={colors.error} />
            <Text style={[settingsStyles.actionRowText, { color: colors.error }]}>
              {t('settings.disconnectAndClearData', {
                defaultValue: 'Sign out and delete all data',
              })}
            </Text>
            <MaterialCommunityIcons
              name="chevron-right"
              size={20}
              color={isDark ? darkColors.textMuted : colors.textSecondary}
            />
          </TouchableOpacity>
        </>
      )}
    </View>
  );
}

// Memoize to prevent re-renders when parent re-renders
export const ProfileAccountSection = memo(ProfileAccountSectionComponent);

const styles = StyleSheet.create({
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
    ...typography.cardTitle,
    fontSize: 17,
    color: colors.textPrimary,
  },
  profileEmail: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: 2,
  },
  scopeContainer: {
    marginTop: spacing.xs,
  },
  scopeTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  scopeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
});
