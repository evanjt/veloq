/**
 * The line a section's lap times carry while some of their time streams are
 * not downloaded: the efforts on screen are a partial set, so the best among
 * them may not be the best there is.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';

export interface SectionStreamsNoticeProps {
  isDark: boolean;
  /** Activities whose time streams are still missing. */
  outstanding: number;
  onRetry: () => void;
}

export function SectionStreamsNotice({ isDark, outstanding, onRetry }: SectionStreamsNoticeProps) {
  const { t } = useTranslation();
  const tint = isDark ? darkColors.textSecondary : colors.textSecondary;
  return (
    <View testID="section-streams-partial" style={styles.row}>
      <MaterialCommunityIcons name="cloud-off-outline" size={iconSize.sm} color={tint} />
      <Text style={[styles.text, isDark && styles.textDark]}>
        {t('sections.effortsNotDownloaded', { count: outstanding })}
      </Text>
      <Button label={t('common.retry')} variant="ghost" size="sm" onPress={onRetry} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  text: {
    ...typography.caption,
    flex: 1,
    color: colors.textSecondary,
  },
  textDark: {
    color: darkColors.textSecondary,
  },
});
