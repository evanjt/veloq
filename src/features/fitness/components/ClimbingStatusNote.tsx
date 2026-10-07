import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing, typography } from '@/theme';
import type { ClimbStatus } from '@/features/stats';

interface ClimbingStatusNoteProps {
  status: ClimbStatus | undefined;
}

/** Why the climbing windows may be empty: rows still being computed, tracks left out for their elevation source. */
export function ClimbingStatusNote({ status }: ClimbingStatusNoteProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  if (!status || (status.owed === 0 && status.sourceExcluded === 0)) return null;
  const textStyle = [styles.text, isDark && styles.textDark];

  return (
    <View style={styles.container}>
      {status.owed > 0 ? (
        <Text style={textStyle} testID="climbing-owed">
          {t('bestEffortsScreen.climbingOwed')}
        </Text>
      ) : null}
      {status.sourceExcluded > 0 ? (
        <Text style={textStyle} testID="climbing-source-excluded">
          {t('bestEffortsScreen.climbingSourceExcluded', { excluded: status.sourceExcluded })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingTop: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  text: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
});
