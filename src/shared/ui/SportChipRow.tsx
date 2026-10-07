import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import {
  colors,
  darkColors,
  ink,
  layout,
  spacing,
  typography,
  colorWithOpacity,
  slopToMinTapTarget,
} from '@/theme';
import { ACTIVITY_CATEGORIES } from '@/shared/activity/sportCategories';
import { pressable, pressRipple } from './pressFeedback';

export interface SportChip {
  key: string;
  label: string;
  count?: number;
  testID?: string;
}

interface SportChipRowProps {
  chips: readonly SportChip[];
  selected: ReadonlySet<string>;
  onToggle: (key: string) => void;
  isDark: boolean;
  children?: React.ReactNode;
}

export function SportChipRow({ chips, selected, onToggle, isDark, children }: SportChipRowProps) {
  const { t } = useTranslation();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={styles.scroller}
      contentContainerStyle={styles.row}
    >
      {chips.map((chip) => {
        const active = selected.has(chip.key);
        const category = ACTIVITY_CATEGORIES[chip.key];
        const fill = category?.selectedFill ?? colors.primary;
        const labelInk = category?.selectedInk ?? colors.textOnPrimary;
        return (
          <Pressable
            key={chip.key}
            testID={chip.testID}
            accessibilityRole="button"
            accessibilityLabel={t(chip.label, chip.key)}
            hitSlop={slopToMinTapTarget(typography.bodySmall.lineHeight + spacing.xs * 2)}
            accessibilityState={{ selected: active }}
            onPress={() => onToggle(chip.key)}
            style={pressable([
              styles.chip,
              isDark ? styles.chipDark : styles.chipLight,
              active && { backgroundColor: fill },
            ])}
            android_ripple={pressRipple}
          >
            <Text
              style={[
                styles.label,
                {
                  color: active
                    ? labelInk
                    : isDark
                      ? darkColors.textSecondary
                      : colors.textSecondary,
                },
              ]}
            >
              {t(chip.label, chip.key)}
              {chip.count !== undefined && (
                <Text
                  style={[
                    styles.count,
                    {
                      color: active
                        ? colorWithOpacity(labelInk, 0.8)
                        : isDark
                          ? colorWithOpacity(ink.white, 0.45)
                          : colorWithOpacity(ink.black, 0.35),
                    },
                  ]}
                >
                  {' '}
                  {chip.count}
                </Text>
              )}
            </Text>
          </Pressable>
        );
      })}
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroller: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    paddingHorizontal: spacing.smPlus,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadius,
  },
  chipLight: { backgroundColor: colorWithOpacity(ink.black, 0.08) },
  chipDark: { backgroundColor: colorWithOpacity(ink.white, 0.15) },
  label: { fontSize: typography.bodySmall.fontSize, fontWeight: '600' },
  count: { fontSize: typography.caption.fontSize, fontWeight: '400' },
});
