import React, { useState, useCallback } from 'react';
import { View, StyleSheet, Pressable } from 'react-native';
import { Text, Button, TextInput } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { colors, darkColors, spacing } from '@/theme';
import { useTheme } from '@/hooks';
import { CollapsibleSection } from '@/components/ui/CollapsibleSection';

interface ApiKeyLoginFormProps {
  onLogin: (apiKey: string) => Promise<void>;
  isLoading: boolean;
  disabled: boolean;
  onOpenDeveloperSettings: () => void;
}

export const ApiKeyLoginForm = React.memo(function ApiKeyLoginForm({
  onLogin,
  isLoading,
  disabled,
  onOpenDeveloperSettings,
}: ApiKeyLoginFormProps) {
  const { t } = useTranslation();
  const { isDark, colors: themeColors } = useTheme();

  const [apiKey, setApiKey] = useState('');
  const [expanded, setExpanded] = useState(false);

  const handleSubmit = useCallback(() => {
    onLogin(apiKey);
  }, [onLogin, apiKey]);

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

        <Pressable onPress={onOpenDeveloperSettings} style={styles.getApiKeyLink}>
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
          disabled={isLoading || disabled}
        />

        <Button
          testID="login-apikey-button"
          mode="contained"
          onPress={handleSubmit}
          loading={isLoading}
          disabled={isLoading || !apiKey.trim()}
          style={styles.apiKeyButton}
          icon="login"
        >
          {isLoading ? t('login.connecting') : t('login.apiKeyConnect')}
        </Button>

        <View style={styles.localModeNote}>
          <MaterialCommunityIcons name="shield-check" size={14} color={themeColors.textSecondary} />
          <Text style={[styles.localModeText, isDark && styles.textMuted]}>
            {t('login.localModeNote')}
          </Text>
        </View>
        <View style={styles.localModeNote}>
          <MaterialCommunityIcons
            name="bell-off-outline"
            size={14}
            color={themeColors.textSecondary}
          />
          <Text style={[styles.localModeText, isDark && styles.textMuted]}>
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
  linkText: {
    fontSize: 14,
    color: colors.primary,
    textDecorationLine: 'underline',
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
  textDark: {
    color: darkColors.textSecondary,
  },
  textMuted: {
    color: darkColors.textMuted,
  },
});
