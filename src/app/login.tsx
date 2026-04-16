import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Linking,
  Pressable,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Text, Button } from 'react-native-paper';
import { ScreenSafeAreaView } from '@/components/ui';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { replaceTo } from '@/lib';
import { useTranslation } from 'react-i18next';
import { useAuthStore, useSyncDateRange, useUploadPermissionStore } from '@/providers';
import { colors, darkColors, spacing, layout } from '@/theme';
import { useTheme } from '@/hooks';
import { createSharedStyles } from '@/styles';
import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import {
  startOAuthFlow,
  handleOAuthCallback,
  isOAuthConfigured,
  INTERVALS_URLS,
  getAppRedirectUri,
} from '@/services/oauth';
import { clearAllAppCaches } from '@/lib/storage';
import { useImportDatabaseBackup } from '@/hooks';
import { getAvailableBackends, type BackupEntry } from '@/lib/backup';
import { restoreDatabaseBackup } from '@/lib/export/backup';
import * as FileSystem from 'expo-file-system/legacy';
import { getRouteEngine } from '@/lib/native/routeEngine';
import { LanguagePicker, OAuthLoginForm, ApiKeyLoginForm } from '@/components/login';

const VELOQ_URLS = {
  privacy: 'https://veloq.fit/privacy',
};

export default function LoginScreen() {
  const { t } = useTranslation();
  const { isDark, colors: themeColors } = useTheme();
  const shared = createSharedStyles(isDark);
  const setOAuthCredentials = useAuthStore((state) => state.setOAuthCredentials);
  const setCredentials = useAuthStore((state) => state.setCredentials);
  const enterDemoMode = useAuthStore((state) => state.enterDemoMode);
  const sessionExpired = useAuthStore((state) => state.sessionExpired);
  const clearSessionExpired = useAuthStore((state) => state.clearSessionExpired);
  const queryClient = useQueryClient();
  const resetSyncDateRange = useSyncDateRange((state) => state.reset);
  const { importDatabaseBackup, importing: isRestoring } = useImportDatabaseBackup();

  // Auto-detect available backups on fresh install
  const [detectedBackup, setDetectedBackup] = useState<{
    entry: BackupEntry;
    backendId: string;
    backendName: string;
  } | null>(null);
  const [restoringDetected, setRestoringDetected] = useState(false);
  const [dismissedRestore, setDismissedRestore] = useState(false);

  useEffect(() => {
    const engine = getRouteEngine();
    const activityCount = engine?.getActivityCount() ?? 0;
    if (activityCount > 0) return;

    (async () => {
      try {
        const backends = await getAvailableBackends();
        for (const backend of backends) {
          try {
            const backups = await backend.listBackups();
            if (backups.length > 0) {
              setDetectedBackup({
                entry: backups[0],
                backendId: backend.id,
                backendName: backend.name,
              });
              return;
            }
          } catch {
            // Skip backends that fail
          }
        }
      } catch {
        // Silently fail - auto-detect is best-effort
      }
    })();
  }, []);

  const handleRestoreDetected = useCallback(async () => {
    if (!detectedBackup || restoringDetected) return;
    setRestoringDetected(true);
    try {
      const backends = await getAvailableBackends();
      const backend = backends.find((b) => b.id === detectedBackup.backendId);
      if (!backend) throw new Error('Backend not available');

      const tempPath = `${FileSystem.cacheDirectory}restore-temp.veloqdb`;
      await backend.download(detectedBackup.entry.id, tempPath);

      const result = await restoreDatabaseBackup(tempPath);
      await FileSystem.deleteAsync(tempPath, { idempotent: true });

      if (result.success) {
        const messages = [t('backup.databaseRestored', { count: result.activityCount })];
        if (result.athleteIdMismatch) {
          messages.push(
            `\n${t('backup.differentAccount', { defaultValue: 'Warning: This backup belongs to a different account.' })}`
          );
        }
        Alert.alert(t('backup.restoreComplete'), messages.join(''));
        setDetectedBackup(null);
      } else {
        Alert.alert(t('common.error'), result.error ?? t('backup.importError'));
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : t('backup.importError');
      Alert.alert(t('common.error'), msg);
    } finally {
      setRestoringDetected(false);
    }
  }, [detectedBackup, restoringDetected, t]);

  const [isLoading, setIsLoading] = useState(false);
  const [isApiKeyLoading, setIsApiKeyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Show session expired message if redirected here due to token expiry
  useEffect(() => {
    if (sessionExpired) {
      const message =
        sessionExpired === 'token_revoked' ? t('login.sessionRevoked') : t('login.sessionExpired');
      setError(message);
      clearSessionExpired();
    }
  }, [sessionExpired, t, clearSessionExpired]);

  const handleTryDemo = async () => {
    await clearAllAppCaches(queryClient);
    resetSyncDateRange();
    enterDemoMode();
    replaceTo('/');
  };

  const handleCreateAccount = () => {
    Linking.openURL(INTERVALS_URLS.signup);
  };

  const handleOpenVeloqPrivacy = () => {
    Linking.openURL(VELOQ_URLS.privacy);
  };

  const handleOpenIntervalsPrivacy = () => {
    Linking.openURL(INTERVALS_URLS.privacyPolicy);
  };

  const handleOpenIntervalsTerms = () => {
    Linking.openURL(INTERVALS_URLS.termsOfService);
  };

  const handleOpenDeveloperSettings = useCallback(() => {
    Linking.openURL(INTERVALS_URLS.developerSettings);
  }, []);

  const handleApiKeyLogin = useCallback(
    async (apiKey: string) => {
      if (!apiKey.trim()) {
        setError(t('login.apiKeyRequired'));
        return;
      }

      setIsApiKeyLoading(true);
      setError(null);

      try {
        const response = await axios.get('https://intervals.icu/api/v1/athlete/me', {
          headers: {
            Authorization: `Basic ${btoa('API_KEY:' + apiKey.trim())}`,
          },
          timeout: 10000,
        });

        const athlete = response.data;
        if (!athlete?.id) {
          throw new Error('Invalid response');
        }

        await clearAllAppCaches(queryClient);
        resetSyncDateRange();
        await setCredentials(apiKey.trim(), athlete.id);
        replaceTo('/');
      } catch (err: unknown) {
        if (axios.isAxiosError(err) && err.response?.status === 401) {
          setError(t('login.invalidApiKey'));
        } else {
          setError(t('login.connectionFailed'));
        }
      } finally {
        setIsApiKeyLoading(false);
      }
    },
    [t, queryClient, resetSyncDateRange, setCredentials]
  );

  const handleOAuthLogin = useCallback(async () => {
    if (!isOAuthConfigured()) {
      setError(t('login.oauthNotConfigured'));
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await startOAuthFlow();

      if (result.type === 'success' && result.url) {
        const expectedPrefix = getAppRedirectUri();
        if (!result.url.startsWith(expectedPrefix)) {
          setError(t('login.oauthInvalidCallback', { defaultValue: 'Invalid OAuth callback URL' }));
          setIsLoading(false);
          return;
        }

        const tokenResponse = handleOAuthCallback(result.url);

        await clearAllAppCaches(queryClient);
        resetSyncDateRange();

        await setOAuthCredentials(
          tokenResponse.access_token,
          tokenResponse.athlete_id,
          tokenResponse.athlete_name
        );

        if (tokenResponse.scope) {
          useUploadPermissionStore.getState().setFromOAuthScope(tokenResponse.scope);
        }

        replaceTo('/');
      } else if (result.type === 'cancel') {
        setIsLoading(false);
        return;
      } else {
        setError(t('login.oauthFailed'));
      }
    } catch (err: unknown) {
      let errorMessage = t('login.connectionFailed');
      if (err instanceof Error) {
        if (
          err.message.includes('state validation failed') ||
          err.message.includes('missing state parameter')
        ) {
          errorMessage = t('login.oauthStateValidationFailed');
        } else {
          errorMessage = err.message;
        }
      }
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  }, [t, queryClient, resetSyncDateRange, setOAuthCredentials]);

  return (
    <ScreenSafeAreaView style={shared.container} testID="login-screen">
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <LanguagePicker />

        {/* Logo/Header */}
        <View style={styles.header}>
          <Text style={[styles.title, isDark && styles.textLight]}>{t('login.title')}</Text>
          <Text style={[styles.subtitle, isDark && styles.textDark]}>{t('login.subtitle')}</Text>
        </View>

        {/* Main Login Section */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          {error && (
            <View style={styles.errorContainer}>
              <MaterialCommunityIcons name="alert-circle" size={20} color={colors.error} />
              <Text style={styles.errorText} testID="login-error-text">
                {error}
              </Text>
            </View>
          )}

          {/* Detected backup banner (fresh install only) */}
          {detectedBackup && !dismissedRestore && (
            <View style={[styles.restoreBanner, isDark && styles.restoreBannerDark]}>
              <View style={styles.restoreBannerHeader}>
                <MaterialCommunityIcons name="backup-restore" size={20} color={colors.primary} />
                <Text style={[styles.restoreBannerTitle, isDark && styles.textLight]}>
                  {t('backup.backupFound', { defaultValue: 'Backup Found' })}
                </Text>
                <TouchableOpacity
                  onPress={() => setDismissedRestore(true)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <MaterialCommunityIcons
                    name="close"
                    size={18}
                    color={isDark ? darkColors.textMuted : colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>
              <Text style={[styles.restoreBannerDetail, isDark && styles.textDark]}>
                {detectedBackup.entry.activityCount}{' '}
                {t('common.activities', { defaultValue: 'activities' })}
                {' · '}
                {new Date(detectedBackup.entry.timestamp).toLocaleDateString()}
                {' · '}
                {detectedBackup.backendName}
              </Text>
              <Button
                mode="contained"
                onPress={handleRestoreDetected}
                loading={restoringDetected}
                disabled={restoringDetected}
                style={styles.restoreBannerButton}
                icon="database-import-outline"
                compact
              >
                {restoringDetected ? t('backup.importingDatabase') : t('backup.restoreFromBackup')}
              </Button>
            </View>
          )}

          {/* OAuth Login */}
          <OAuthLoginForm onLogin={handleOAuthLogin} isLoading={isLoading} />

          {/* Divider */}
          <View style={styles.dividerContainer}>
            <View style={[styles.divider, isDark && styles.dividerDark]} />
            <Text style={[styles.dividerText, isDark && styles.textDark]}>
              {t('common.or', { defaultValue: 'or' })}
            </Text>
            <View style={[styles.divider, isDark && styles.dividerDark]} />
          </View>

          {/* Demo Button */}
          <Button
            testID="login-demo-button"
            mode="outlined"
            onPress={handleTryDemo}
            disabled={isLoading || isApiKeyLoading}
            style={styles.demoButton}
            icon="play-circle-outline"
          >
            {t('login.tryDemo', { defaultValue: 'Try Demo' })}
          </Button>

          {/* Restore from Backup */}
          <Button
            testID="login-restore-button"
            mode="text"
            onPress={importDatabaseBackup}
            disabled={isLoading || isApiKeyLoading || isRestoring}
            style={styles.restoreButton}
            icon="database-import-outline"
            compact
          >
            {isRestoring
              ? t('backup.importingDatabase')
              : t('backup.restoreFromBackup', { defaultValue: 'Restore from Backup' })}
          </Button>

          {/* API Key Login */}
          <ApiKeyLoginForm
            onLogin={handleApiKeyLogin}
            isLoading={isApiKeyLoading}
            disabled={isLoading}
            onOpenDeveloperSettings={handleOpenDeveloperSettings}
          />
        </View>

        {/* New User Section */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          <Text style={[styles.newUserTitle, isDark && styles.textLight]}>
            {t('login.noAccount')}
          </Text>
          <Text style={[styles.newUserText, isDark && styles.textDark]}>
            {t('login.createAccountHint')}
          </Text>
          <Button
            mode="text"
            onPress={handleCreateAccount}
            icon="open-in-new"
            style={styles.createAccountButton}
          >
            {t('login.createAccount')}
          </Button>
        </View>

        {/* Disclaimer Footer */}
        <View style={styles.disclaimerContainer}>
          <Text style={[styles.disclaimerText, isDark && styles.textMuted]}>
            {t('login.disclaimer')}
          </Text>

          <Pressable onPress={handleOpenVeloqPrivacy} style={styles.veloqPrivacyLink}>
            <MaterialCommunityIcons name="shield-lock" size={14} color={colors.primary} />
            <Text style={styles.linkText}>{t('about.veloqPrivacy')}</Text>
          </Pressable>

          <Text style={[styles.intervalsLabel, isDark && styles.textMuted]}>intervals.icu:</Text>
          <View style={styles.linksRow}>
            <Pressable onPress={handleOpenIntervalsPrivacy}>
              <Text style={styles.linkTextSmall}>{t('login.privacyPolicy')}</Text>
            </Pressable>
            <Text style={[styles.linkSeparator, isDark && styles.textMuted]}>|</Text>
            <Pressable onPress={handleOpenIntervalsTerms}>
              <Text style={styles.linkTextSmall}>{t('login.termsOfService')}</Text>
            </Pressable>
          </View>
        </View>

        {/* Security note */}
        <View style={styles.securityNote}>
          <MaterialCommunityIcons name="shield-lock" size={16} color={themeColors.textSecondary} />
          <Text style={[styles.securityText, isDark && styles.textDark]}>
            {t('login.securityNote')}
          </Text>
        </View>
      </ScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
    padding: layout.screenPadding,
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginBottom: spacing.xl,
  },
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
  textMuted: {
    color: darkColors.textMuted,
  },
  subtitle: {
    fontSize: 16,
    color: colors.textSecondary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: layout.borderRadius,
    padding: layout.cardPadding,
    marginBottom: spacing.md,
  },
  cardDark: {
    backgroundColor: darkColors.surface,
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(244, 67, 54, 0.1)',
    padding: spacing.sm,
    borderRadius: 8,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  errorText: {
    color: colors.error,
    flex: 1,
    fontSize: 14,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.lg,
  },
  divider: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  dividerDark: {
    backgroundColor: darkColors.border,
  },
  dividerText: {
    marginHorizontal: spacing.md,
    color: colors.textSecondary,
    fontSize: 14,
  },
  demoButton: {
    borderColor: colors.primary,
  },
  restoreButton: {
    marginTop: spacing.sm,
  },
  restoreBanner: {
    backgroundColor: 'rgba(252, 76, 2, 0.06)',
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: 'rgba(252, 76, 2, 0.15)',
  },
  restoreBannerDark: {
    backgroundColor: 'rgba(252, 76, 2, 0.1)',
    borderColor: 'rgba(252, 76, 2, 0.2)',
  },
  restoreBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.xs,
  },
  restoreBannerTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  restoreBannerDetail: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  restoreBannerButton: {
    alignSelf: 'flex-start',
  },
  newUserTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  newUserText: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  createAccountButton: {
    alignSelf: 'flex-start',
    marginLeft: -spacing.sm,
  },
  disclaimerContainer: {
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  disclaimerText: {
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  veloqPrivacyLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  intervalsLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  linksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  linkText: {
    fontSize: 14,
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  linkTextSmall: {
    fontSize: 12,
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  linkSeparator: {
    color: colors.textSecondary,
  },
  securityNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  securityText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
});
