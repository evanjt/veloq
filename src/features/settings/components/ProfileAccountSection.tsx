import React, { useState, memo } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { useTheme, useIsOnline } from '@/shared/app';
import { ChromeIcon } from '@/shared/ui/ChromeIcon';
import { RowDivider } from '@/shared/ui/RowGroup';
import { useQueryClient } from '@tanstack/react-query';
import { colors, darkColors, iconSize, layout, spacing, typography } from '@/theme';
import { getStoredCredentials, useAuthStore } from '@/shared/app/AuthStore';
import { SCHEME_LABEL_KEY, sourceFor } from '@/shared/app/source';
import { INTERVALS_URLS } from '@/shared/app/constants';
import { useUploadPermissionStore } from '@/features/recording';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { clearAccountData, clearAuthOnly, wipeConfirmMessage } from '@/shared/storage';
import { useTranslation } from 'react-i18next';
import { settingsStyles } from './settingsStyles';
import { Row } from '@/shared/ui/Row';
import { ExternalLinkRow } from '@/shared/ui/ExternalLinkRow';
import { offlineConfirmMessage } from '../lib/offlineConfirmCopy';
import { useExportRecordBackup } from '../hooks/useBackup';
import { chooseAction, confirmAction, inform } from '@/shared/ui/dialog';
import { Icon } from '@/shared/ui/Icon';
import type { Athlete } from '@/types';

interface ProfileAccountSectionProps {
  athlete?: Athlete | undefined;
}

function ProfileAccountSectionComponent({ athlete }: ProfileAccountSectionProps) {
  const { isDark } = useTheme();
  const errorText = isDark ? darkColors.errorText : colors.errorText;
  const { t } = useTranslation();
  const isOnline = useIsOnline();
  const [profileImageError, setProfileImageError] = useState(false);
  const authMethod = useAuthStore((state) => state.authMethod);
  const grantedScopes = useUploadPermissionStore((s) => s.grantedScopes);

  // Logout logic (moved from AccountSection)
  const queryClient = useQueryClient();
  const clearCredentials = useAuthStore((s) => s.clearCredentials);
  const resetSyncDateRange = useSyncDateRange((s) => s.reset);
  const { exportRecordBackup } = useExportRecordBackup();

  const finishLogout = async (clearAll: boolean) => {
    try {
      // Cancel in-flight queries first to prevent re-fetches during teardown
      await queryClient.cancelQueries();
      if (clearAll) {
        await clearAccountData(queryClient);
      } else {
        await clearAuthOnly(queryClient);
      }
      // Recordings stay on device and keep their place in the queue. The hold
      // at the next sign-in keeps one athlete's rides out of another's account.
      resetSyncDateRange();
      useUploadPermissionStore.getState().reset();
      // Clear credentials last - AuthGate detects isAuthenticated=false and
      // navigates to /login after the navigation settles to avoid an Android crash.
      await clearCredentials();
    } catch {
      inform({ title: t('alerts.disconnectFailedTitle'), message: t('alerts.failedToDisconnect') });
    }
  };

  // Plain "Sign out" - keep cached activities/GPS/sections, and the athlete
  // profile and sport settings with them, so re-login on the same account is
  // instant and works with no network. Only the credentials go. "Sign out and
  // clear data" is the path that takes the rest.
  const handleLogout = () => {
    // A demo holds no credentials and needs no connection to start again, so
    // its confirm says only that the sample library closes.
    if (authMethod === 'demo') {
      confirmAction({
        title: t('alerts.leaveDemoTitle'),
        message: t('alerts.leaveDemoMessage'),
        confirmLabel: t('alerts.leaveDemoConfirm'),
        cancelLabel: t('common.cancel'),
        destructive: true,
        onConfirm: () => {
          finishLogout(false);
        },
      });
      return;
    }
    confirmAction({
      title: t('alerts.signOutTitle'),
      message: offlineConfirmMessage(
        t('alerts.signOutMessage'),
        t('alerts.disconnectOffline'),
        isOnline
      ),
      confirmLabel: t('alerts.signOut'),
      cancelLabel: t('common.cancel'),
      destructive: true,
      onConfirm: () => {
        finishLogout(false);
      },
    });
  };

  // Destructive option - wipe everything. For switching to a different
  // account, freeing storage, or starting clean. The message lists what comes
  // back at the next sign-in and what is deleted for good, from the wipe's own
  // inventory, and the athlete can take a backup before accepting.
  const handleLogoutAndClearData = () => {
    chooseAction({
      title: t('alerts.disconnectAndClearTitle', {
        defaultValue: 'Sign out and delete data?',
      }),
      message: offlineConfirmMessage(
        wipeConfirmMessage(t),
        t('alerts.disconnectOffline'),
        isOnline
      ),
      cancelLabel: t('common.cancel'),
      actions: [
        {
          label: t('alerts.disconnectAndClearBackUpFirst'),
          onPress: () => {
            void backUpFirst();
          },
        },
        {
          label: t('alerts.disconnectAndClearConfirm', {
            defaultValue: 'Delete and sign out',
          }),
          destructive: true,
          onPress: () => {
            finishLogout(true);
          },
        },
      ],
    });
  };

  // The record export, then the same confirm again once its file has been
  // offered. A failed export reports itself and leaves the choice there; one
  // still writing offers its file when it ends.
  const backUpFirst = async () => {
    if ((await exportRecordBackup()) === 'complete') handleLogoutAndClearData();
  };

  const profileUrl = athlete?.profileMedium;
  const hasValidProfileUrl =
    profileUrl && typeof profileUrl === 'string' && profileUrl.startsWith('http');

  const source = sourceFor({ authMethod });
  const authBadge = source ? t(SCHEME_LABEL_KEY[source.scheme]) : '';

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
      CHATS: t('settings.scopeChats', 'Chats'),
      LIBRARY: t('settings.scopeLibrary', 'Library'),
    };
    const map = new Map<string, Set<string>>();
    for (const s of scopes.split(',')) {
      const [cat, perm] = s.trim().split(':');
      if (!cat || !perm) continue;
      let perms = map.get(cat);
      if (!perms) {
        perms = new Set();
        map.set(cat, perms);
      }
      perms.add(perm.toUpperCase());
    }
    const result: { label: string; level: string }[] = [];
    for (const [cat, perms] of map) {
      const label = categoryNames[cat] ?? cat.charAt(0) + cat.slice(1).toLowerCase();
      // WRITE implies READ per intervals.icu spec
      const hasWrite = perms.has('WRITE');
      const level = hasWrite ? t('settings.scopeWrite', 'Write') : t('settings.scopeRead', 'Read');
      result.push({ label, level });
    }
    return result;
  };

  const isDemo = source?.id === 'demo';
  const signOutLabel = isDemo ? t('settings.leaveDemo') : t('settings.signOut');
  // The OAuth label already names intervals.icu, so only an API key session
  // carries the source beside its method.
  const accountLine =
    isDemo || source?.scheme === 'oauth' ? authBadge : `intervals.icu · ${authBadge}`;
  const isOAuth = source?.can.scoped === true;
  const parsedScopes = isOAuth && grantedScopes ? parseScopes(grantedScopes) : [];
  const profile = (
    <>
      <View style={[styles.profilePhoto, isDark && styles.profilePhotoDark]}>
        {hasValidProfileUrl && !profileImageError ? (
          <Image
            accessibilityIgnoresInvertColors
            source={{ uri: profileUrl }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onError={() => setProfileImageError(true)}
          />
        ) : (
          <Icon
            name="account"
            size={iconSize.xl}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        )}
      </View>
      <View style={styles.profileInfo}>
        <Text style={[styles.profileName, isDark && settingsStyles.textLight]}>
          {athlete?.name || t('settings.athleteFallback', 'Athlete')}
        </Text>
        <Text style={[styles.profileEmail, isDark && settingsStyles.textSecondary]}>
          {accountLine}
        </Text>
        {isOAuth && parsedScopes.length > 0 ? (
          <View style={styles.scopeContainer}>
            <Text style={[styles.scopeTitle, isDark && settingsStyles.textSecondary]}>
              {t('settings.permissions', 'Permissions')}
            </Text>
            <View style={styles.scopeRow}>
              {parsedScopes.map((s) => (
                <Text
                  key={s.label}
                  style={[settingsStyles.scopeText, isDark && settingsStyles.textSecondary]}
                >
                  {s.label}: {s.level}
                </Text>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </>
  );

  return (
    <View
      testID="settings-profile-section"
      style={[settingsStyles.sectionCard, isDark && settingsStyles.sectionCardDark]}
    >
      {/* Profile row: the athlete's intervals.icu page, which a demo account has none of. */}
      {isDemo ? (
        <Row>{profile}</Row>
      ) : (
        <ExternalLinkRow
          url={INTERVALS_URLS.athletePage(getStoredCredentials().athleteId ?? '')}
          label={athlete?.name || t('settings.athleteFallback', 'Athlete')}
        >
          {profile}
        </ExternalLinkRow>
      )}

      {/* Logout row - keeps cached data for instant re-login */}
      <RowDivider />
      <Row
        testID="settings-logout-button"
        behaviour="act"
        onPress={handleLogout}
        accessibilityLabel={signOutLabel}
      >
        <Icon
          name="logout"
          size={iconSize.lg}
          color={isDark ? darkColors.textSecondary : colors.textSecondary}
        />
        <Text style={[settingsStyles.actionRowText, isDark && settingsStyles.textLight]}>
          {signOutLabel}
        </Text>
      </Row>

      {/* Destructive sign-out - wipes activities/GPS/sections too */}
      {!isDemo && (
        <>
          <RowDivider />
          <Row
            testID="settings-logout-clear-button"
            behaviour="act"
            onPress={handleLogoutAndClearData}
            accessibilityLabel={t('settings.disconnectAndClearData', {
              defaultValue: 'Sign out and delete all data',
            })}
          >
            <ChromeIcon name="delete" size={iconSize.lg} color={colors.errorText} />
            <Text style={[settingsStyles.actionRowText, { color: errorText }]}>
              {t('settings.disconnectAndClearData', {
                defaultValue: 'Sign out and delete all data',
              })}
            </Text>
          </Row>
        </>
      )}
    </View>
  );
}

// Memoize to prevent re-renders when parent re-renders
export const ProfileAccountSection = memo(ProfileAccountSectionComponent);

const styles = StyleSheet.create({
  profilePhoto: {
    width: 56,
    height: 56,
    borderRadius: layout.borderRadiusFull,
    backgroundColor: colors.surfacePage,
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  profilePhotoDark: {
    backgroundColor: darkColors.surfaceRaised,
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    ...typography.cardTitle,
    fontSize: typography.cardTitle.fontSize,
    color: colors.textPrimary,
  },
  profileEmail: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  scopeContainer: {
    marginTop: spacing.xs,
  },
  scopeTitle: {
    ...typography.caption,
    color: colors.textSecondary,
    marginBottom: spacing.xxs,
  },
  scopeRow: {
    gap: spacing.xxs,
  },
});
