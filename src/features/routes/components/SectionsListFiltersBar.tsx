import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { spacing } from '@/theme';
import { SelectButton, ToggleButton } from '@/shared/ui';
import type { SectionsSortOption } from './SectionsList';

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
  }[];
  customCount: number;
  hiddenFilters: HiddenFilters;
  onFilterPress: (filterType: keyof HiddenFilters) => void;
  trueDisabledCount: number;
  unacceptedAutoCount: number;
  acceptedAutoCount: number;
}

/**
 * The sort, a choice of one from more than three orders, is the menu control.
 * Each filter is on or off on its own, so it is a selector chip.
 */
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

  return (
    <View style={styles.row}>
      {regularSectionsCount > 1 && (
        <SelectButton
          testID="sections-sort"
          accessibilityLabel={t('routes.sortBy')}
          value={sortOption}
          options={sortChips.map((chip) => ({ value: chip.key, label: chip.label }))}
          onChange={onSortChange}
        />
      )}
      {customCount > 0 && (
        <ToggleButton
          icon="account"
          label={t('routes.customCount', { count: customCount })}
          selected={!hiddenFilters.custom}
          onPress={() => onFilterPress('custom')}
        />
      )}
      {trueDisabledCount > 0 && (
        <ToggleButton
          icon={hiddenFilters.disabled ? 'eye-off' : 'eye'}
          label={t('sections.removedCount', { count: trueDisabledCount })}
          selected={!hiddenFilters.disabled}
          onPress={() => onFilterPress('disabled')}
        />
      )}
      {unacceptedAutoCount > 0 && acceptedAutoCount > 0 && (
        <ToggleButton
          icon="pin"
          label={t('sections.acceptedOnly')}
          selected={hiddenFilters.unaccepted}
          onPress={() => onFilterPress('unaccepted')}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xxs,
    marginBottom: spacing.xs,
  },
});
