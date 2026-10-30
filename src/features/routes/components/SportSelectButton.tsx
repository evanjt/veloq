/**
 * The sport on a section or route page: a dropdown beside the date range that
 * names the sport on screen with its count and unit and lists every sport the page
 * offers. A page with one sport has nothing to choose, so it states the sport
 * as plain text instead.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/shared/app';
import { getActivityIcon } from '@/shared/activity/activityUtils';
import { FitText, SelectButton } from '@/shared/ui';
import { colors, darkColors, typography } from '@/theme';

export interface SportTypeOption {
  type: string;
  count?: number;
}

interface SportSelectButtonProps {
  /** Every sport offered, in the order the menu lists them. */
  options: readonly SportTypeOption[];
  selectedType: string | undefined;
  onSelect: (type: string) => void;
  style?: StyleProp<ViewStyle>;
}

export function SportSelectButton({
  options,
  selectedType,
  onSelect,
  style,
}: SportSelectButtonProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const labelOf = ({ type, count }: SportTypeOption) =>
    count === undefined
      ? t(`activityTypes.${type}`, type)
      : `${t(`activityTypes.${type}`, type)} · ${t('sections.traversalsCount', { count })}`;

  const [only] = options;
  if (only === undefined) return null;
  if (options.length === 1) {
    return (
      <FitText
        testID="section-sport"
        style={[styles.single, isDark && styles.singleDark, style as never]}
      >
        {labelOf(only)}
      </FitText>
    );
  }
  return (
    <SelectButton
      testID="section-sport"
      {...(style !== undefined && { style })}
      accessibilityLabel={t('sections.sportFilter')}
      options={options.map((option) => ({
        value: option.type,
        label: labelOf(option),
        icon: getActivityIcon(option.type),
      }))}
      value={selectedType ?? null}
      onChange={onSelect}
    />
  );
}

const styles = StyleSheet.create({
  single: { ...typography.body, color: colors.textPrimary },
  singleDark: { color: darkColors.textPrimary },
});
