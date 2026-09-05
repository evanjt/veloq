/**
 * The way out of a per-job surface and into the list of all of them.
 *
 * Detection settings and sync settings each carry one job's progress line.
 * Those lines stay where they are, because that is where a user already looks
 * for them, and this row says the rest of the work has a home.
 */

import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { router, type Href } from 'expo-router';

import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing, typography, layout } from '@/theme';

export function BackgroundJobsLink() {
  const { t } = useTranslation();
  const { isDark } = useTheme();

  const textPrimary = isDark ? colors.textOnDark : colors.textPrimary;
  const textSecondary = isDark ? darkColors.textSecondary : colors.textSecondary;

  return (
    <Pressable
      style={styles.row}
      onPress={() => router.push('/background-jobs' as Href)}
      accessibilityRole="button"
      testID="background-jobs-link"
    >
      <MaterialCommunityIcons name="progress-clock" size={20} color={textSecondary} />
      <Text style={[styles.label, { color: textPrimary }]}>{t('backgroundJobs.openLink')}</Text>
      <MaterialCommunityIcons name="chevron-right" size={22} color={textSecondary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    minHeight: layout.minTapTarget,
  },
  label: {
    ...typography.body,
    flex: 1,
  },
});
