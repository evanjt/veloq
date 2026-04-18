import React, { useState, useEffect, useCallback } from 'react';
import { View, StyleSheet, ScrollView, Linking, Pressable } from 'react-native';
import { Text, Button } from 'react-native-paper';
import { ScreenSafeAreaView } from '@/components/ui';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { replaceTo } from '@/lib';
import { useTranslation } from 'react-i18next';
import { useAuthStore, useSyncDateRange } from '@/providers';
import { colors, darkColors, spacing, layout } from '@/theme';
import { useTheme } from '@/hooks';
import { createSharedStyles } from '@/styles';
import { useQueryClient } from '@tanstack/react-query';
import { INTERVALS_URLS } from '@/services/oauth';
import { clearAllAppCaches } from '@/lib/storage';
import { useImportDatabaseBackup } from '@/hooks';
import { useApiKeyLogin, useOAuthLogin, useBackupRestore } from '@/hooks/auth';
import {
  LanguagePicker,
  OAuthLoginForm,
  ApiKeyLoginForm,
  BackupRestoreBanner,
} from '@/components/login';

const VELOQ_URLS = {
  privacy: 'https://veloq.fit/privacy',
};

export default function LoginScreen() {
  const { t } = useTranslation();
  const { isDark, colors: themeColors } = useTheme();
  const shared = createSharedStyles(isDark);
  const enterDemoMode = useAuthStore((state) => state.enterDemoMode);
  const sessionExpired = useAuthStore((state) => state.sessionExpired);
  const clearSessionExpired = useAuthStore((state) => state.clearSessionExpired);
  const queryClient = useQueryClient();
  const resetSyncDateRange = useSyncDateRange((state) => state.reset);
  const { importDatabaseBackup, importing: isRestoring } = useImportDatabaseBackup();

  const {
    detectedBackup,
    restoringDetected,
    dismissedRestore,
    setDismissedRestore,
    handleRestoreDetected,
  } = useBackupRestore();

  const [error, setError] = useState<string | null>(null);

  const { handleApiKeyLogin, isApiKeyLoading } = useApiKeyLogin({ setError });
  const { handleOAuthLogin, isLoading } = useOAuthLogin({ setError });

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
          {detectedBackup && (
            <BackupRestoreBanner
              backup={detectedBackup}
              isDismissed={dismissedRestore}
              onDismiss={() => setDismissedRestore(true)}
              onRestore={handleRestoreDetected}
              isRestoring={restoringDetected}
            />
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
