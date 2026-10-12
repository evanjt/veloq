import React, { useState, useCallback } from 'react';
import { View, StyleSheet, Linking } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';

import {
  ScreenSafeAreaView,
  ScreenScrollView,
  Button,
  SectionTitle,
  StatusLine,
  TextLink,
} from '@/shared/ui';
import { replaceTo } from '@/shared/app/navigation';
import { useSyncDateRange } from '@/shared/app/SyncDateRangeStore';
import { colors, darkColors, spacing, layout, typography, colorWithOpacity } from '@/theme';
import { useTheme } from '@/shared/app';
import { createSharedStyles } from '@/styles';
import { clearAccountData } from '@/shared/storage';
import { RestoreChooser } from '@/features/settings';
import {
  useAuthStore,
  INTERVALS_URLS,
  demoEntryAction,
  confirmAccountChange,
  getCachedAthleteId,
  UNNAMED_LIBRARY,
  useApiKeyLogin,
  useOAuthLogin,
  useApiKeyPrefill,
  useSessionExpiryNotice,
  LanguagePicker,
  OAuthLoginForm,
  ApiKeyLoginForm,
  SessionExpiredNotice,
} from '@/features/auth';
import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

const VELOQ_URLS = {
  privacy: 'https://veloq.fit/privacy',
};

function LoginScreenContent() {
  const { t } = useTranslation();
  const { isDark, colors: themeColors } = useTheme();
  const shared = createSharedStyles(isDark);
  const enterDemoMode = useAuthStore((state) => state.enterDemoMode);
  const queryClient = useQueryClient();
  const resetSyncDateRange = useSyncDateRange((state) => state.reset);
  const [showRestore, setShowRestore] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // An expired session is not a failed login, so it never takes the red slot.
  // The two do not stack either: whichever arrived last is the one on screen.
  const [sessionNotice, dismissSessionNotice] = useSessionExpiryNotice();
  const prefillApiKey = useApiKeyPrefill(sessionNotice);
  const reportError = useCallback(
    (message: string | null) => {
      if (message) dismissSessionNotice();
      setError(message);
    },
    [dismissSessionNotice]
  );

  const { handleApiKeyLogin, isApiKeyLoading, queuedMessage, discardQueuedKey } = useApiKeyLogin({
    setError: reportError,
  });
  const { handleOAuthLogin, isLoading } = useOAuthLogin({
    setError: reportError,
    discardQueuedKey,
  });

  const handleTryDemo = async () => {
    // Warn before destroying a real account's cached data. Engine holds at
    // most one account at a time, so leftover real-user data has to be
    // wiped before demo can populate. Same dialog as account-switch on login.
    // A backup restored from this screen leaves a library no credential names,
    // so the count is what stands between it and the demo fixtures. The engine
    // is closed here by design and a closed handle reports no activities, so
    // the count comes from the library rather than from the handle.
    if ((await demoEntryAction()) === 'confirm-then-wipe') {
      const proceed = await confirmAccountChange({
        cachedAthleteId: (await getCachedAthleteId()) ?? UNNAMED_LIBRARY,
        incomingKind: 'demo',
      });
      // A refusal drops a key queued offline, as a refused sign-in does.
      if (!proceed) {
        await discardQueuedKey();
        return;
      }
    }
    // A wipe that could not run now says so rather than resolving, and demo
    // mode must not open over a library that is still there: that is how the
    // Demo Mode banner came to be drawn over an athlete's own rides.
    try {
      await clearAccountData(queryClient);
    } catch {
      reportError(t('alerts.failedToClear'));
      return;
    }
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
      <ScreenScrollView contentContainerStyle={styles.scrollContent}>
        <LanguagePicker />

        {/* Logo/Header */}
        <View style={styles.header}>
          <SectionTitle level="screen" align="center" style={styles.title}>
            {t('login.title')}
          </SectionTitle>
          <Text style={[styles.subtitle, isDark && styles.textDark]}>{t('login.subtitle')}</Text>
        </View>

        {/* Main Login Section */}
        <View style={[styles.card, isDark && styles.cardDark]}>
          {sessionNotice && <SessionExpiredNotice notice={sessionNotice} />}

          {error && !sessionNotice && (
            <StatusLine tone="error" message={error} style={styles.errorContainer}>
              <MaterialCommunityIcons name="alert-circle" size={20} color={colors.error} />
              <Text
                style={[styles.errorText, isDark && styles.errorTextDark]}
                testID="login-error-text"
              >
                {error}
              </Text>
            </StatusLine>
          )}

          {queuedMessage && !error && (
            <StatusLine tone="info" message={queuedMessage} style={styles.queuedContainer}>
              <MaterialCommunityIcons name="cloud-off-outline" size={20} color={colors.secondary} />
              <Text
                style={[styles.queuedText, isDark && styles.queuedTextDark]}
                testID="login-queued-text"
              >
                {queuedMessage}
              </Text>
              <Button
                testID="login-discard-queued-key"
                label={t('recording.discard')}
                variant="ghost"
                size="sm"
                onPress={discardQueuedKey}
              />
            </StatusLine>
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
            label={t('login.tryDemo', { defaultValue: 'Try Demo' })}
            variant="secondary"
            onPress={handleTryDemo}
            disabled={isLoading || isApiKeyLoading}
            icon={
              <MaterialCommunityIcons name="play-circle-outline" size={18} color={colors.primary} />
            }
          />

          {/* Restore from Backup */}
          <Button
            testID="login-restore-button"
            label={t('backup.restoreFromBackup', { defaultValue: 'Restore from Backup' })}
            variant="ghost"
            size="sm"
            onPress={() => setShowRestore((shown) => !shown)}
            disabled={isLoading || isApiKeyLoading}
            style={styles.restoreButton}
            icon={
              <MaterialCommunityIcons
                name="database-import-outline"
                size={18}
                color={colors.primary}
              />
            }
          />
          {showRestore && (
            <View style={styles.restoreChooser}>
              <RestoreChooser />
            </View>
          )}

          {/* API Key Login */}
          <ApiKeyLoginForm
            onLogin={handleApiKeyLogin}
            isLoading={isApiKeyLoading}
            disabled={isLoading}
            onOpenDeveloperSettings={handleOpenDeveloperSettings}
            prefillApiKey={prefillApiKey}
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
            label={t('login.createAccount')}
            variant="ghost"
            onPress={handleCreateAccount}
            icon={<MaterialCommunityIcons name="open-in-new" size={18} color={colors.primary} />}
            style={styles.createAccountButton}
          />
        </View>

        {/* Disclaimer Footer */}
        <View style={styles.disclaimerContainer}>
          <Text style={[styles.disclaimerText, isDark && styles.textSecondary]}>
            {t('login.disclaimer')}
          </Text>

          <TextLink
            label={t('about.veloqPrivacy')}
            onPress={handleOpenVeloqPrivacy}
            icon="shield-lock"
            style={styles.veloqPrivacyLink}
          />

          <Text style={[styles.intervalsLabel, isDark && styles.textSecondary]}>
            intervals.icu:
          </Text>
          <View style={styles.linksRow}>
            <TextLink
              label={t('login.privacyPolicy')}
              onPress={handleOpenIntervalsPrivacy}
              size="caption"
            />
            <Text style={[styles.linkSeparator, isDark && styles.textSecondary]}>|</Text>
            <TextLink
              label={t('login.termsOfService')}
              onPress={handleOpenIntervalsTerms}
              size="caption"
            />
          </View>
        </View>

        {/* Security note */}
        <View style={styles.securityNote}>
          <MaterialCommunityIcons name="shield-lock" size={16} color={themeColors.textSecondary} />
          <Text style={[styles.securityText, isDark && styles.textDark]}>
            {t('login.securityNote')}
          </Text>
        </View>
      </ScreenScrollView>
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
    marginBottom: spacing.xs,
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
  textSecondary: {
    color: darkColors.textSecondary,
  },
  subtitle: {
    fontSize: typography.body.fontSize,
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
    backgroundColor: colorWithOpacity(colors.error, 0.1),
    padding: spacing.sm,
    borderRadius: layout.borderRadiusSm,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  errorText: {
    color: colors.errorDeep,
    flex: 1,
    fontSize: typography.bodySmall.fontSize,
  },
  errorTextDark: {
    color: darkColors.errorDeep,
  },
  queuedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colorWithOpacity(colors.secondary, 0.1),
    padding: spacing.sm,
    borderRadius: layout.borderRadiusSm,
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  queuedText: {
    color: colors.textSecondary,
    flex: 1,
    fontSize: typography.bodySmall.fontSize,
  },
  queuedTextDark: {
    color: darkColors.textSecondary,
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
    fontSize: typography.bodySmall.fontSize,
  },
  restoreButton: {
    marginTop: spacing.sm,
  },
  restoreChooser: {
    marginTop: spacing.md,
  },
  newUserTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  newUserText: {
    fontSize: typography.bodySmall.fontSize,
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
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
    textAlign: 'center',
    lineHeight: 18,
    marginBottom: spacing.sm,
  },
  veloqPrivacyLink: {
    marginBottom: spacing.md,
  },
  intervalsLabel: {
    fontSize: typography.label.fontSize,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  linksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
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
    fontSize: typography.caption.fontSize,
    color: colors.textSecondary,
  },
});

export default withScreenBoundary(LoginScreenContent, 'Login');
