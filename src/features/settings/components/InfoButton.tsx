import React from 'react';
import { Alert } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { IconButton } from '@/shared/ui';
import { useTheme } from '@/shared/app';
import { colors, darkColors } from '@/theme';

interface InfoButtonProps {
  testID: string;
  /** What the explanation is about, shown as the alert's title. */
  title: string;
  /** The explanation. It is not drawn on the screen until the button is pressed. */
  message: string;
}

/** A small info glyph that holds a screen's explanation behind a press. */
export function InfoButton({ testID, title, message }: InfoButtonProps) {
  const { isDark } = useTheme();
  const { t } = useTranslation();

  return (
    <IconButton
      testID={testID}
      accessibilityLabel={t('backup.moreInfo')}
      onPress={() => Alert.alert(title, message)}
    >
      <MaterialCommunityIcons
        name="information-outline"
        size={20}
        color={isDark ? darkColors.textSecondary : colors.textSecondary}
      />
    </IconButton>
  );
}
