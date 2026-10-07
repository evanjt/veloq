import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors, controlHeight, spacing, slopToMinTapTarget } from '@/theme';
import { ACTIVITY_CATEGORIES } from '@/shared/activity/sportCategories';
import { ToggleButton } from './Button';

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
  children?: React.ReactNode;
}

export function SportChipRow({ chips, selected, onToggle, children }: SportChipRowProps) {
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
        const category = ACTIVITY_CATEGORIES[chip.key];
        return (
          <ToggleButton
            key={chip.key}
            {...(chip.testID && { testID: chip.testID })}
            label={t(chip.label, chip.key)}
            selected={selected.has(chip.key)}
            fill={category?.selectedFill ?? colors.primary}
            ink={category?.selectedInk ?? colors.textOnPrimary}
            {...(chip.count !== undefined && { count: chip.count })}
            onPress={() => onToggle(chip.key)}
          />
        );
      })}
      {children}
    </ScrollView>
  );
}

// A horizontal scroller clips its children, so the row is as tall as the chips'
// tap targets rather than their drawn height, or the slop above and below would
// fall outside it and take no touch.
const rowInset = Math.max(spacing.xs, slopToMinTapTarget(controlHeight.chip).top);

const styles = StyleSheet.create({
  scroller: { flexGrow: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: rowInset },
});
