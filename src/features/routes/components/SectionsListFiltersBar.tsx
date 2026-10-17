import React from 'react';
import { View, Pressable, StyleSheet } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme } from '@/shared/app';
import {
  colorWithOpacity,
  opacity,
  colors,
  darkColors,
  iconSize,
  layout,
  slopToMinTapTarget,
  spacing,
  typography,
  stroke,
  themedStyles,
  type Palette,
  themePalette,
} from '@/theme';
import { pressable, pressRipple } from '@/shared/ui';
import type { SectionsSortOption } from './SectionsList';

const CHIP_HEIGHT = typography.caption.lineHeight + 2 * (spacing.xs + stroke.one);
const chipHitSlop = slopToMinTapTarget(CHIP_HEIGHT);

const activeChipStyles = (palette: Palette) =>
  StyleSheet.create({
    chip: {
      backgroundColor: colorWithOpacity(palette.primary, opacity.tint1),
      borderColor: palette.primary,
    },
  });

type HiddenFilters = {
  custom: boolean;
  auto: boolean;
  disabled: boolean;
  unaccepted: boolean;
};

interface SectionsListFiltersBarProps {
  regularSectionsCount: number;
  sortOption: SectionsSortOption;
  onSortChange: (next: SectionsSortOption) => void;
  sortChips: {
    key: SectionsSortOption;
    label: string;
    icon: keyof typeof MaterialCommunityIcons.glyphMap;
  }[];
  customCount: number;
  hiddenFilters: HiddenFilters;
  onFilterPress: (filterType: keyof HiddenFilters) => void;
  trueDisabledCount: number;
  unacceptedAutoCount: number;
  acceptedAutoCount: number;
}

export function SectionsListFiltersBar({
  regularSectionsCount,
  sortOption,
  onSortChange,
  sortChips,
  customCount,
  hiddenFilters,
  onFilterPress,
  trueDisabledCount,
  unacceptedAutoCount,
  acceptedAutoCount,
}: SectionsListFiltersBarProps) {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const palette = themePalette(isDark);
  const active = themedStyles(activeChipStyles, isDark);

  return (
    <View style={styles.sortChipRow}>
      {regularSectionsCount > 1 &&
        sortChips.map((chip) => {
          const isActive = sortOption === chip.key;
          return (
            <Pressable
              key={chip.key}
              style={pressable([
                styles.sortChip,
                isDark && styles.sortChipDark,
                isActive && active.chip,
              ])}
              android_ripple={pressRipple}
              onPress={() => onSortChange(chip.key)}
              hitSlop={chipHitSlop}
              accessibilityRole="button"
              accessibilityLabel={chip.label}
              accessibilityState={{ selected: isActive }}
            >
              <MaterialCommunityIcons
                name={chip.icon}
                size={iconSize.xs}
                color={
                  isActive
                    ? palette.primary
                    : isDark
                      ? darkColors.textSecondary
                      : colors.textSecondary
                }
              />
              <Text
                style={[
                  styles.sortChipLabel,
                  isDark && styles.textSecondary,
                  isActive && styles.sortChipLabelActive,
                  isActive && isDark && { color: darkColors.actionLink },
                ]}
              >
                {chip.label}
              </Text>
            </Pressable>
          );
        })}
      {customCount > 0 && (
        <Pressable
          style={pressable([
            styles.sortChip,
            isDark && styles.sortChipDark,
            !hiddenFilters.custom && active.chip,
          ])}
          android_ripple={pressRipple}
          onPress={() => onFilterPress('custom')}
          hitSlop={chipHitSlop}
          accessibilityRole="button"
          accessibilityLabel={t('routes.customCount', { count: customCount })}
          accessibilityState={{ selected: !hiddenFilters.custom }}
        >
          <MaterialCommunityIcons
            name="account"
            size={iconSize.xs}
            color={
              !hiddenFilters.custom
                ? palette.primary
                : isDark
                  ? darkColors.textSecondary
                  : colors.textSecondary
            }
          />
          <Text
            style={[
              styles.sortChipLabel,
              isDark && styles.textSecondary,
              !hiddenFilters.custom && styles.sortChipLabelActive,
              !hiddenFilters.custom && isDark && { color: darkColors.actionLink },
            ]}
          >
            {t('routes.customCount', { count: customCount })}
          </Text>
        </Pressable>
      )}
      {trueDisabledCount > 0 && (
        <Pressable
          style={pressable([
            styles.sortChip,
            isDark && styles.sortChipDark,
            !hiddenFilters.disabled && active.chip,
          ])}
          android_ripple={pressRipple}
          onPress={() => onFilterPress('disabled')}
          hitSlop={chipHitSlop}
          accessibilityRole="button"
          accessibilityLabel={t('sections.removedCount', { count: trueDisabledCount })}
          accessibilityState={{ selected: !hiddenFilters.disabled }}
        >
          <MaterialCommunityIcons
            name={hiddenFilters.disabled ? 'eye-off' : 'eye'}
            size={iconSize.xs}
            color={
              !hiddenFilters.disabled
                ? palette.primary
                : isDark
                  ? darkColors.textSecondary
                  : colors.textSecondary
            }
          />
          <Text
            style={[
              styles.sortChipLabel,
              isDark && styles.textSecondary,
              !hiddenFilters.disabled && styles.sortChipLabelActive,
              !hiddenFilters.disabled && isDark && { color: darkColors.actionLink },
            ]}
          >
            {t('sections.removedCount', { count: trueDisabledCount })}
          </Text>
        </Pressable>
      )}
      {unacceptedAutoCount > 0 && acceptedAutoCount > 0 && (
        <Pressable
          style={pressable([
            styles.sortChip,
            isDark && styles.sortChipDark,
            hiddenFilters.unaccepted && active.chip,
          ])}
          android_ripple={pressRipple}
          onPress={() => onFilterPress('unaccepted')}
          hitSlop={chipHitSlop}
          accessibilityRole="button"
          accessibilityLabel={t('sections.acceptedOnly')}
          accessibilityState={{ selected: hiddenFilters.unaccepted }}
        >
          <MaterialCommunityIcons
            name="pin"
            size={iconSize.xs}
            color={
              hiddenFilters.unaccepted
                ? palette.primary
                : isDark
                  ? darkColors.textSecondary
                  : colors.textSecondary
            }
          />
          <Text
            style={[
              styles.sortChipLabel,
              isDark && styles.textSecondary,
              hiddenFilters.unaccepted && styles.sortChipLabelActive,
              hiddenFilters.unaccepted && isDark && { color: darkColors.actionLink },
            ]}
          >
            {t('sections.acceptedOnly')}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  sortChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xxs,
    marginBottom: spacing.xs,
  },
  sortChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.smPlus,
    paddingVertical: spacing.xs,
    borderRadius: layout.borderRadius,
    borderWidth: stroke.one,
    borderColor: colors.border,
  },
  sortChipDark: {
    borderColor: darkColors.border,
  },
  sortChipLabel: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  sortChipLabelActive: {
    color: colors.actionLink,
  },
  textSecondary: {
    color: darkColors.textSecondary,
  },
});
