import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ScrollView, Linking, Pressable, TouchableOpacity } from 'react-native';
import { Text, Button, TextInput } from 'react-native-paper';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenSafeAreaView } from '@/components/ui';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, Href } from 'expo-router';
import { useTranslation } from 'react-i18next';
import {
  useAuthStore,
  useLanguageStore,
  getAvailableLanguages,
  isLanguageVariant,
  isEnglishVariant,
  getEnglishVariantValue,
} from '@/providers';
import { colors, darkColors, spacing, layout, typography, brand } from '@/theme';
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

const VELOQ_URLS = {
  privacy: 'https://veloq.fit/privacy',
};
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';
import { clearAllAppCaches } from '@/lib/storage';
import { useSyncDateRange } from '@/providers';

export default function LoginScreen() {
  const { t } = useTranslation();
  const { isDark, colors: themeColors } = useTheme();
  const shared = createSharedStyles(isDark);
  const insets = useSafeAreaInsets();
  const setOAuthCredentials = useAuthStore((state) => state.setOAuthCredentials);
  const setCredentials = useAuthStore((state) => state.setCredentials);
  const enterDemoMode = useAuthStore((state) => state.enterDemoMode);
  const sessionExpired = useAuthStore((state) => state.sessionExpired);
  const clearSessionExpired = useAuthStore((state) => state.clearSessionExpired);
  const queryClient = useQueryClient();
  const resetSyncDateRange = useSyncDateRange((state) => state.reset);

  // Language selection
  const { language, setLanguage } = useLanguageStore();
  const [showLanguages, setShowLanguages] = useState(false);
  const availableLanguages = getAvailableLanguages();

  const [isLoading, setIsLoading] = useState(false);
  const [isApiKeyLoading, setIsApiKeyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [apiKeyExpanded, setApiKeyExpanded] = useState(false);

  // Get the display label for the current language selection and check if it's a dialect
  const { currentLanguageLabel, isDialectSelected } = React.useMemo(() => {
    for (const group of availableLanguages) {
      for (const lang of group.languages) {
        if (language === lang.value) {
          return { currentLanguageLabel: lang.label, isDialectSelected: false };
        }
        // Check variants
        if (lang.variants) {
          const variant = lang.variants.find((v) => v.value === language);
          if (variant) {
            return {
              currentLanguageLabel: `${lang.label} (${variant.label})`,
              isDialectSelected: variant.isDialect ?? false,
            };
          }
        }
        // Check if current language is a variant of this language
        if (isLanguageVariant(language, lang.value)) {
          return { currentLanguageLabel: lang.label, isDialectSelected: false };
        }
      }
    }
    return { currentLanguageLabel: 'English', isDialectSelected: false }; // Fallback
  }, [language, availableLanguages]);

  const handleLanguageChange = async (value: string) => {
    await setLanguage(value);
    setShowLanguages(false);
  };

  // Show session expired message if redirected here due to token expiry
  useEffect(() => {
    if (sessionExpired) {
      const message =
        sessionExpired === 'token_revoked' ? t('login.sessionRevoked') : t('login.sessionExpired');
      setError(message);
      // Clear the session expired flag after showing the message
      clearSessionExpired();
    }
  }, [sessionExpired, t, clearSessionExpired]);

  const handleTryDemo = async () => {
    // Clear ALL cached data from previous sessions (including persisted caches)
    await clearAllAppCaches(queryClient);
    // Reset sync date range to default 90 days
    resetSyncDateRange();
    // Enter demo mode
    enterDemoMode();
    // Navigate to main app
    router.replace('/' as Href);
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

      // Clear ALL cached data from previous sessions (including persisted caches)
      await clearAllAppCaches(queryClient);
      // Reset sync date range to default 90 days
      resetSyncDateRange();

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
        // Validate that the callback URL matches expected scheme before processing
        const expectedPrefix = getAppRedirectUri();
        if (!result.url.startsWith(expectedPrefix)) {
          setError(t('login.oauthInvalidCallback', { defaultValue: 'Invalid OAuth callback URL' }));
          setIsLoading(false);
          return;
        }

        // Handle the callback URL (token is already in URL from proxy)
        const tokenResponse = handleOAuthCallback(result.url);

        // Clear ALL cached data from previous sessions (including persisted caches)
        await clearAllAppCaches(queryClient);
        // Reset sync date range to default 90 days
        resetSyncDateRange();

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
      let errorMessage = t('login.connectionFailed');
      if (err instanceof Error) {
        // Check for CSRF/state validation errors and show user-friendly message
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
  };

  return (
    <ScreenSafeAreaView style={shared.container} testID="login-screen">
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        {/* Language Selector - top right */}
        <View style={styles.languagePickerContainer}>
          <TouchableOpacity
            testID="login-language-button"
            style={[
              styles.languageButton,
              isDark && styles.languageButtonDark,
              isDialectSelected && styles.languageButtonDialect,
              isDialectSelected && isDark && styles.languageButtonDialectDark,
            ]}
            onPress={() => setShowLanguages(!showLanguages)}
          >
            <MaterialCommunityIcons
              name="translate"
              size={18}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
            />
            <Text style={[styles.languageButtonText, isDark && styles.textDark]}>
              {currentLanguageLabel}
            </Text>
            <MaterialCommunityIcons
              name={showLanguages ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
            />
          </TouchableOpacity>
        </View>

        {/* Language Dropdown */}
        {showLanguages && (
          <View style={[styles.languageDropdown, isDark && styles.languageDropdownDark]}>
            {/* Dialect legend - fixed at top right, styled as chip */}
            <View style={[styles.dialectLegendHeader, isDark && styles.dialectLegendHeaderDark]}>
              <View
                style={[
                  styles.variantChip,
                  isDark && styles.variantChipDark,
                  styles.variantChipDialect,
                  isDark && styles.variantChipDialectDark,
                  styles.dialectLegendChip,
                ]}
              >
                <Text style={[styles.variantChipText, isDark && styles.textMuted]}>
                  {t('settings.dialect')}
                </Text>
              </View>
            </View>
            {availableLanguages.flatMap((group, groupIndex) =>
              group.languages.map((lang, langIndex) => {
                const index = groupIndex * 100 + langIndex;
                const isSelected = language === lang.value;
                const isVariantOfThisLanguage = isLanguageVariant(language, lang.value);
                const showCheck = isSelected || isVariantOfThisLanguage;

                return (
                  <View
                    key={lang.value}
                    style={[
                      styles.languageRow,
                      index > 0 && styles.languageRowBorder,
                      isDark && styles.languageRowDark,
                    ]}
                  >
                    <TouchableOpacity
                      onPress={() => {
                        const valueToUse =
                          lang.defaultVariant ?? lang.variants?.[0]?.value ?? lang.value;
                        handleLanguageChange(valueToUse);
                      }}
                      style={styles.languageLabelContainer}
                    >
                      <Text style={[styles.languageLabel, isDark && styles.textLight]}>
                        {lang.label}
                      </Text>
                    </TouchableOpacity>
                    {lang.variants && (
                      <View style={styles.variantChips}>
                        {lang.variants.map((variant) => {
                          const isVariantSelected =
                            language === variant.value ||
                            (lang.value === 'en' &&
                              isEnglishVariant(language) &&
                              getEnglishVariantValue(language) === variant.value);
                          return (
                            <TouchableOpacity
                              key={variant.value}
                              style={[
                                styles.variantChip,
                                isDark && styles.variantChipDark,
                                variant.isDialect &&
                                  !isVariantSelected &&
                                  styles.variantChipDialect,
                                variant.isDialect &&
                                  !isVariantSelected &&
                                  isDark &&
                                  styles.variantChipDialectDark,
                                isVariantSelected && styles.variantChipSelected,
                                isVariantSelected && isDark && styles.variantChipSelectedDark,
                                variant.isDialect &&
                                  isVariantSelected &&
                                  styles.variantChipDialectSelected,
                                variant.isDialect &&
                                  isVariantSelected &&
                                  isDark &&
                                  styles.variantChipDialectSelectedDark,
                              ]}
                              onPress={() => handleLanguageChange(variant.value)}
                            >
                              <Text
                                style={[
                                  styles.variantChipText,
                                  isVariantSelected && styles.variantChipTextSelected,
                                  isDark && !isVariantSelected && styles.textMuted,
                                ]}
                              >
                                {variant.label}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </View>
                    )}
                    {showCheck && !lang.variants && (
                      <MaterialCommunityIcons name="check" size={20} color={colors.primary} />
                    )}
                  </View>
                );
              })
            )}
          </View>
        )}

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
            testID="login-apikey-section"
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
                outlineColor={isDark ? darkColors.border : colors.border}
                activeOutlineColor={colors.primary}
                textColor={themeColors.text}
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
                  color={themeColors.textSecondary}
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

          {/* Veloq Privacy - prominent */}
          <Pressable onPress={handleOpenVeloqPrivacy} style={styles.veloqPrivacyLink}>
            <MaterialCommunityIcons name="shield-lock" size={14} color={colors.primary} />
            <Text style={styles.linkText}>{t('about.veloqPrivacy')}</Text>
          </Pressable>

          {/* intervals.icu links - clearly labeled */}
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
  // Note: container now uses shared styles
  scrollContent: {
    flexGrow: 1,
    padding: layout.screenPadding,
    justifyContent: 'center',
  },
  // Language picker styles
  languagePickerContainer: {
    alignItems: 'flex-end',
    marginBottom: spacing.md,
  },
  languageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  languageButtonDark: {
    backgroundColor: darkColors.surface,
    borderColor: darkColors.border,
  },
  languageButtonDialect: {
    borderColor: brand.gold,
    borderWidth: 2,
  },
  languageButtonDialectDark: {
    borderColor: brand.goldLight,
  },
  languageButtonText: {
    fontSize: 14,
    color: colors.textSecondary,
  },
  languageDropdown: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginBottom: spacing.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.border,
  },
  languageDropdownDark: {
    backgroundColor: darkColors.surface,
    borderColor: darkColors.border,
  },
  languageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  languageRowBorder: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  languageRowDark: {
    borderTopColor: darkColors.border,
  },
  languageLabelContainer: {
    flex: 1,
    paddingVertical: spacing.xs,
  },
  languageLabel: {
    fontSize: 16,
    color: colors.textPrimary,
  },
  variantChips: {
    flexDirection: 'row',
    gap: 6,
    marginLeft: 'auto',
  },
  variantChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  variantChipDark: {
    backgroundColor: darkColors.surfaceElevated,
    borderColor: darkColors.border,
  },
  variantChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  variantChipSelectedDark: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  variantChipDialect: {
    borderColor: brand.gold,
  },
  variantChipDialectDark: {
    borderColor: brand.goldLight,
  },
  variantChipDialectSelected: {
    borderColor: brand.gold,
    borderWidth: 2,
  },
  variantChipDialectSelectedDark: {
    borderColor: brand.goldLight,
    borderWidth: 2,
  },
  variantChipText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  variantChipTextSelected: {
    color: colors.textOnDark,
  },
  dialectLegendHeader: {
    position: 'absolute',
    top: spacing.sm,
    // Match row paddingHorizontal minus border (1px)
    right: spacing.md - 1,
    zIndex: 1,
  },
  dialectLegendHeaderDark: {},
  dialectLegendChip: {
    // Use same padding as variantChip for consistent sizing
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
