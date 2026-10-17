import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';
import { useTheme } from '@/shared/app';
import { CollapsibleSection } from '@/shared/ui/CollapsibleSection';
import { Button, TextField, TextLink } from '@/shared/ui';

interface ApiKeyLoginFormProps {
  onLogin: (apiKey: string) => Promise<void>;
  isLoading: boolean;
  disabled: boolean;
  onOpenDeveloperSettings: () => void;
  /** The key a rejected session left behind, or null for a first sign-in. */
  prefillApiKey?: string | null;
}

export const ApiKeyLoginForm = React.memo(function ApiKeyLoginForm({
  onLogin,
  isLoading,
  disabled,
  onOpenDeveloperSettings,
  prefillApiKey = null,
}: ApiKeyLoginFormProps) {
  const { t } = useTranslation();
  const { isDark, colors: themeColors } = useTheme();

  const [apiKey, setApiKey] = useState('');
  const [expanded, setExpanded] = useState(false);

  // The prefill arrives a keychain read after the first paint, and the section
  // is shut until then, so seeding it also has to open the section or the key
  // sits behind a tap nobody knows to make. Once only: a second pass would
  // type over whatever the athlete has since pasted.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !prefillApiKey) return;
    seeded.current = true;
    setApiKey(prefillApiKey);
    setExpanded(true);
  }, [prefillApiKey]);

  const handleSubmit = useCallback(() => {
    onLogin(apiKey);
  }, [onLogin, apiKey]);

  // Return connects like the button does, and is inert where the button is
  // disabled.
  const handleReturn = useCallback(() => {
    if (apiKey.trim()) handleSubmit();
  }, [apiKey, handleSubmit]);

  return (
    <CollapsibleSection
      testID="login-apikey-section"
      title={t('login.useApiKey')}
      expanded={expanded}
      onToggle={setExpanded}
      icon="key-variant"
      style={styles.apiKeySection}
    >
      <View style={styles.apiKeyContent}>
        <Text style={[styles.apiKeyDescription, isDark && styles.textDark]}>
          {t('login.apiKeyDescription')}
        </Text>

        <TextLink
          label={t('login.getApiKey')}
          onPress={onOpenDeveloperSettings}
          icon="open-in-new"
          iconPosition="trailing"
          style={styles.getApiKeyLink}
        />

        <TextField
          testID="login-apikey-input"
          label={t('settings.authApiKey')}
          value={apiKey}
          onChangeText={setApiKey}
          placeholder={t('login.apiKeyPlaceholder')}
          secureTextEntry
          textContentType="password"
          autoComplete="password"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={handleReturn}
          style={styles.apiKeyInput}
          editable={!(isLoading || disabled)}
        />

        <Button
          testID="login-apikey-button"
          label={isLoading ? t('login.connecting') : t('login.apiKeyConnect')}
          onPress={handleSubmit}
          loading={isLoading}
          disabled={!apiKey.trim()}
          icon="login"
        />

        <View style={styles.localModeNote}>
          <MaterialCommunityIcons
            name="shield-check"
            size={iconSize.sm}
            color={themeColors.textSecondary}
          />
          <Text style={[styles.localModeText, isDark && styles.textSecondary]}>
            {t('login.localModeNote')}
          </Text>
        </View>
        <View style={styles.localModeNote}>
          <MaterialCommunityIcons
            name="bell-off-outline"
            size={iconSize.sm}
            color={themeColors.textSecondary}
          />
          <Text style={[styles.localModeText, isDark && styles.textSecondary]}>
            {t('login.apiKeyNoNotifications')}
          </Text>
        </View>
      </View>
    </CollapsibleSection>
  );
});

const styles = StyleSheet.create({
  apiKeySection: {
    marginTop: spacing.lg,
  },
  apiKeyContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  apiKeyDescription: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  getApiKeyLink: {
    marginBottom: spacing.md,
  },
  apiKeyInput: {
    marginBottom: spacing.md,
  },
  localModeNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  localModeText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
  textSecondary: {
    color: darkColors.textSecondary,
  },
});
