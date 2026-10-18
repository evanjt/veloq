/**
 * Sport-type filter chips for cross-sport routes and sections. Localised
 * labels, optional per-sport counts, each sport's dot in its family shade.
 */

import type { StyleProp, ViewStyle } from 'react-native';

import { SportChipRow } from '@/shared/ui/SportChipRow';

export interface SportTypeOption {
  type: string;
  count?: number;
}

interface SportTypeSelectorProps {
  options: readonly SportTypeOption[];
  selectedType: string | undefined;
  onSelect: (type: string) => void;
  /** Where the row sits in its parent's layout; it carries no margin of its own. */
  style?: StyleProp<ViewStyle>;
}

export function SportTypeSelector({
  options,
  selectedType,
  onSelect,
  style,
}: SportTypeSelectorProps) {
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
      style={style}
    />
  );
}
