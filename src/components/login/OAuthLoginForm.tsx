import React from 'react';
import { StyleSheet } from 'react-native';
import { Button } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { colors, spacing } from '@/theme';

interface OAuthLoginFormProps {
  onLogin: () => void;
  isLoading: boolean;
}

export const OAuthLoginForm = React.memo(function OAuthLoginForm({
  onLogin,
  isLoading,
}: OAuthLoginFormProps) {
  const { t } = useTranslation();

  return (
    <Button
      testID="login-oauth-button"
      mode="contained"
      onPress={onLogin}
      loading={isLoading}
      disabled={isLoading}
      style={styles.oauthButton}
      contentStyle={styles.oauthButtonContent}
      icon="login"
    >
      {isLoading ? t('login.connecting') : t('login.loginWithIntervals')}
    </Button>
  );
});

const styles = StyleSheet.create({
  oauthButton: {
    backgroundColor: colors.primary,
  },
  oauthButtonContent: {
    paddingVertical: spacing.sm,
  },
});
