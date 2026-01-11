import React, { useState } from 'react';
import { View, StyleSheet, useColorScheme, ScrollView, Linking, Pressable } from 'react-native';
import { Text, Button, TextInput } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenSafeAreaView } from '@/components/ui';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '@/providers';
import { colors, spacing, layout } from '@/theme';
import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import {
  startOAuthFlow,
  handleOAuthCallback,
  isOAuthConfigured,
  INTERVALS_URLS,
} from '@/services/oauth';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';

export default function LoginScreen() {
  const { t } = useTranslation();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const insets = useSafeAreaInsets();
  const setOAuthCredentials = useAuthStore((state) => state.setOAuthCredentials);
  const setCredentials = useAuthStore((state) => state.setCredentials);
  const enterDemoMode = useAuthStore((state) => state.enterDemoMode);
  const queryClient = useQueryClient();

  const [isLoading, setIsLoading] = useState(false);
  const [isApiKeyLoading, setIsApiKeyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyExpanded, setApiKeyExpanded] = useState(false);

  const handleTryDemo = () => {
    // Clear any cached data from previous sessions
    queryClient.clear();
    // Enter demo mode
    enterDemoMode();
    // Navigate to main app
    router.replace('/' as Href);
  };

  const handleCreateAccount = () => {
    Linking.openURL(INTERVALS_URLS.signup);
  };

  const handleOpenPrivacy = () => {
    Linking.openURL(INTERVALS_URLS.privacyPolicy);
  };

  const handleOpenTerms = () => {
    Linking.openURL(INTERVALS_URLS.termsOfService);
  };

  const handleOpenDeveloperSettings = () => {
    Linking.openURL(INTERVALS_URLS.developerSettings);
  };

  const handleApiKeyLogin = async () => {
    if (!apiKey.trim()) {
      setError(t('login.apiKeyRequired'));
      return;
    }

    setIsApiKeyLoading(true);
    setError(null);

    try {
      // Validate API key by calling /athlete/me with temporary axios instance
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

      // Clear any cached data from previous sessions
      queryClient.clear();

      // Store API key credentials
      await setCredentials(apiKey.trim(), athlete.id);

      // Navigate to main app
      router.replace('/' as Href);
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 401) {
        setError(t('login.invalidApiKey'));
      } else {
        setError(t('login.connectionFailed'));
      }
    } finally {
      setIsApiKeyLoading(false);
    }
  };

  const handleOAuthLogin = async () => {
    if (!isOAuthConfigured()) {
      setError(t('login.oauthNotConfigured'));
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await startOAuthFlow();

      if (result.type === 'success' && result.url) {
        // Handle the callback URL (token is already in URL from proxy)
        const tokenResponse = handleOAuthCallback(result.url);

        // Store OAuth credentials
        await setOAuthCredentials(
          tokenResponse.access_token,
          tokenResponse.athlete_id,
          tokenResponse.athlete_name
        );

        // Success - navigate to main app
        router.replace('/' as Href);
      } else if (result.type === 'cancel') {
        // User cancelled - no error needed
        setIsLoading(false);
        return;
      } else {
        setError(t('login.oauthFailed'));
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('login.connectionFailed');
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <ScreenSafeAreaView style={[styles.container, isDark && styles.containerDark]} testID="login-screen">
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
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

          {/* OAuth Login Button */}
          <Button
            testID="login-oauth-button"
            mode="contained"
            onPress={handleOAuthLogin}
            loading={isLoading}
            disabled={isLoading}
            style={styles.oauthButton}
            contentStyle={styles.oauthButtonContent}
            icon="login"
          >
            {isLoading ? t('login.connecting') : t('login.loginWithIntervals')}
          </Button>

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

          {/* API Key Collapsible Section */}
          <CollapsibleSection
            title={t('login.useApiKey')}
            expanded={apiKeyExpanded}
            onToggle={setApiKeyExpanded}
            icon="key-variant"
            style={styles.apiKeySection}
          >
            <View style={styles.apiKeyContent}>
              <Text style={[styles.apiKeyDescription, isDark && styles.textDark]}>
                {t('login.apiKeyDescription')}
              </Text>

              <Pressable onPress={handleOpenDeveloperSettings} style={styles.getApiKeyLink}>
                <Text style={styles.linkText}>{t('login.getApiKey')}</Text>
                <MaterialCommunityIcons name="open-in-new" size={14} color={colors.primary} />
              </Pressable>

              <TextInput
                testID="login-apikey-input"
                mode="outlined"
                value={apiKey}
                onChangeText={setApiKey}
                placeholder={t('login.apiKeyPlaceholder')}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.apiKeyInput}
                outlineColor={isDark ? '#444' : colors.border}
                activeOutlineColor={colors.primary}
                textColor={isDark ? '#FFF' : colors.textPrimary}
                disabled={isApiKeyLoading}
              />

              <Button
                testID="login-apikey-button"
                mode="contained"
                onPress={handleApiKeyLogin}
                loading={isApiKeyLoading}
                disabled={isApiKeyLoading || !apiKey.trim()}
                style={styles.apiKeyButton}
                icon="login"
              >
                {isApiKeyLoading ? t('login.connecting') : t('login.apiKeyConnect')}
              </Button>

              <View style={styles.localModeNote}>
                <MaterialCommunityIcons
                  name="shield-check"
                  size={14}
                  color={isDark ? '#888' : colors.textSecondary}
                />
                <Text style={[styles.localModeText, isDark && styles.textMuted]}>
                  {t('login.localModeNote')}
                </Text>
              </View>
            </View>
          </CollapsibleSection>
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
          <View style={styles.linksRow}>
            <Pressable onPress={handleOpenPrivacy}>
              <Text style={styles.linkText}>{t('login.privacyPolicy')}</Text>
            </Pressable>
            <Text style={[styles.linkSeparator, isDark && styles.textMuted]}>|</Text>
            <Pressable onPress={handleOpenTerms}>
              <Text style={styles.linkText}>{t('login.termsOfService')}</Text>
            </Pressable>
          </View>
        </View>

        {/* Security note */}
        <View style={styles.securityNote}>
          <MaterialCommunityIcons
            name="shield-lock"
            size={16}
            color={isDark ? '#888' : colors.textSecondary}
          />
          <Text style={[styles.securityText, isDark && styles.textDark]}>
            {t('login.securityNote')}
          </Text>
        </View>
      </ScrollView>
    </ScreenSafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  containerDark: {
    backgroundColor: '#121212',
  },
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
    color: '#FFFFFF',
  },
  textDark: {
    color: '#AAA',
  },
  textMuted: {
    color: '#888',
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
    backgroundColor: '#1E1E1E',
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
  oauthButton: {
    backgroundColor: colors.primary,
  },
  oauthButtonContent: {
    paddingVertical: spacing.sm,
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
    backgroundColor: '#333',
  },
  dividerText: {
    marginHorizontal: spacing.md,
    color: colors.textSecondary,
    fontSize: 14,
  },
  demoButton: {
    borderColor: colors.primary,
  },
  apiKeySection: {
    marginTop: spacing.lg,
  },
  apiKeyContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  apiKeyDescription: {
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  getApiKeyLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  apiKeyInput: {
    marginBottom: spacing.md,
    backgroundColor: 'transparent',
  },
  apiKeyButton: {
    backgroundColor: colors.primary,
  },
  localModeNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  localModeText: {
    fontSize: 12,
    color: colors.textSecondary,
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
  linksRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  linkText: {
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
