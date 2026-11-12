import React, { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { Button, TextField, TextLink } from '@/shared/ui';
import { CollapsibleSection } from '@/shared/ui/CollapsibleSection';
import { colors, darkColors, spacing, typography } from '@/theme';

interface GarminLoginFormProps {
  onLogin: (key: string) => Promise<void>;
  isLoading: boolean;
  disabled: boolean;
  onOpenKeyPage: () => void;
}

/** Signing in with a Garmin Personal key and no intervals.icu account. */
export const GarminLoginForm = React.memo(function GarminLoginForm({
  onLogin,
  isLoading,
  disabled,
  onOpenKeyPage,
}: GarminLoginFormProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const [key, setKey] = useState('');
  const [expanded, setExpanded] = useState(false);

  const handleSubmit = useCallback(() => {
    void onLogin(key);
  }, [onLogin, key]);

  return (
    <CollapsibleSection
      testID="login-garmin-section"
      title={t('login.useGarminOnly')}
      expanded={expanded}
      onToggle={setExpanded}
      icon="watch"
      style={styles.section}
    >
      <View style={styles.content}>
        <Text style={[styles.description, isDark && styles.textDark]}>
          {t('login.garminOnlyDescription')}
        </Text>
        <TextLink
          label={t('garmin.getKey')}
          onPress={onOpenKeyPage}
          icon="open-in-new"
          iconPosition="trailing"
          style={styles.link}
        />
        <TextField
          testID="login-garmin-input"
          label={t('garmin.keyLabel')}
          value={key}
          onChangeText={setKey}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="go"
          onSubmitEditing={() => {
            if (key.trim()) handleSubmit();
          }}
          style={styles.input}
          editable={!(isLoading || disabled)}
        />
        <Button
          testID="login-garmin-button"
          label={isLoading ? t('login.connecting') : t('login.garminOnlyConnect')}
          onPress={handleSubmit}
          loading={isLoading}
          disabled={!key.trim() || disabled}
          icon="login"
        />
      </View>
    </CollapsibleSection>
  );
});

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.lg,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  description: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  link: {
    marginBottom: spacing.md,
  },
  input: {
    marginBottom: spacing.md,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
});
