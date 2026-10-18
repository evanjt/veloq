import React from 'react';
import { ScrollView, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { controlHeight, spacing, slopToMinTapTarget } from '@/theme';
import { useTheme } from '@/shared/app';
import { sportMarkColour } from '@/shared/activity/sportCategories';
import { ToggleButton } from './Button';

export interface SportChip {
  key: string;
  label: string;
  count?: number;
  testID?: string;
  /** The family or sport whose dot it draws, when `key` names neither. */
  category?: string;
}

interface SportChipRowBaseProps {
  chips: readonly SportChip[];
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}

/** Any number of chips selected, each tap toggling one. */
interface MultiSelectProps extends SportChipRowBaseProps {
  selected: ReadonlySet<string>;
  onToggle: (key: string) => void;
}

/** At most one chip selected, each tap handing its key to the caller. */
interface SingleSelectProps extends SportChipRowBaseProps {
  value: string | undefined;
  onSelect: (key: string) => void;
}

type SportChipRowProps = MultiSelectProps | SingleSelectProps;

export function SportChipRow(props: SportChipRowProps) {
  const { chips, children, style } = props;
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isSelected = (key: string) =>
    'value' in props ? props.value === key : props.selected.has(key);
  const onPress = (key: string) => ('value' in props ? props.onSelect(key) : props.onToggle(key));
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={[styles.scroller, style]}
      contentContainerStyle={styles.row}
    >
      {chips.map((chip) => (
        // The chip keeps the selector fill and its label names the sport. The dot
        // repeats the label in the family colour, so it is not held to a mark's 3:1
        // on the chip ground, and a chip without a label may not carry one.
        <ToggleButton
          key={chip.key}
          {...(chip.testID && { testID: chip.testID })}
          label={t(chip.label, chip.key)}
          selected={isSelected(chip.key)}
          mark={sportMarkColour(chip.category ?? chip.key, isDark)}
          {...(chip.count !== undefined && { count: chip.count })}
          onPress={() => onPress(chip.key)}
        />
      ))}
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
