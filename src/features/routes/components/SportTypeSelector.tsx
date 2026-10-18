/**
 * Sport-type filter chips for cross-sport routes and sections. Localised
 * labels, optional per-sport counts, each sport's dot in its family shade.
 */

import { StyleSheet } from 'react-native';

import { SportChipRow } from '@/shared/ui/SportChipRow';
import { spacing } from '@/theme';

export interface SportTypeOption {
  type: string;
  count?: number;
}

interface SportTypeSelectorProps {
  options: SportTypeOption[];
  selectedType: string | undefined;
  onSelect: (type: string) => void;
}

export function SportTypeSelector({ options, selectedType, onSelect }: SportTypeSelectorProps) {
  return (
    <SportChipRow
      chips={options.map(({ type, count }) => ({
        key: type,
        label: `activityTypes.${type}`,
        testID: `sport-pill-${type}`,
        ...(count != null && { count }),
      }))}
      value={selectedType}
      onSelect={onSelect}
      style={styles.row}
    />
  );
}

const styles = StyleSheet.create({
  row: { marginHorizontal: spacing.md, marginTop: spacing.md },
});
