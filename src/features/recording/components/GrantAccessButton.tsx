/**
 * The single "Grant Access" affordance for the OAuth write-permission
 * upgrade. Used by the pre-start permission gate, the save error banner,
 * and the recordings-library upgrade banner so the action looks the same
 * everywhere it appears.
 */

import React from 'react';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors } from '@/theme';
import { Button } from '@/shared/ui/Button';

interface GrantAccessButtonProps {
  onPress: () => void;
  loading: boolean;
  small?: boolean;
  testID?: string;
}

export function GrantAccessButton({ onPress, loading, small, testID }: GrantAccessButtonProps) {
  const { t } = useTranslation();
  const label = t('recording.grantAccess', 'Grant Access');

  return (
    <Button
      {...(testID && { testID })}
      label={label}
      size={small ? 'sm' : 'md'}
      onPress={onPress}
      loading={loading}
      icon={
        <MaterialCommunityIcons
          name="shield-lock-outline"
          size={small ? 14 : 16}
          color={colors.textOnPrimary}
        />
      }
    />
  );
}
