import React from 'react';
import { StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui';
import { useTheme } from '@/shared/app';
import { colors, darkColors } from '@/theme';
import { tapTo } from '@/shared/app/navigation';
import type { Period } from '@/shared/app/period';
import { bestEffortsHref } from '@/features/stats';

/** Opens Best Efforts on the range Fitness shows. */
export function BestEffortsHeaderButton({ period }: { period: Period }) {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  return (
    <Button
      testID="fitness-best-efforts-button"
      label={t('bestEffortsScreen.title')}
      variant="ghost"
      size="sm"
      onPress={() => tapTo(bestEffortsHref(period))}
      icon={
        <MaterialCommunityIcons
          name="trophy-outline"
          size={18}
          color={isDark ? darkColors.textPrimary : colors.textPrimary}
        />
      }
      style={styles.button}
    />
  );
}

const styles = StyleSheet.create({
  button: {
    marginLeft: 'auto',
  },
});
