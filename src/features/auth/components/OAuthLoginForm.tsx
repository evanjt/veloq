import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui';

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
      label={isLoading ? t('login.connecting') : t('login.loginWithIntervals')}
      onPress={onLogin}
      loading={isLoading}
      icon="login"
    />
  );
});
