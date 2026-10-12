/**
 * The sport filter on the routes and sections lists: the shared sport chips,
 * one per sport. The engine narrows a list to one sport, so a chip selects its
 * sport and the selected chip pressed again clears the filter.
 */

import { StyleSheet, View } from 'react-native';

import { SportChipRow } from '@/shared/ui/SportChipRow';
import { spacing } from '@/theme';

interface SportFilterChipsProps {
  /** The sports the athlete has activities in. */
  options: readonly string[];
  selectedType: string | undefined;
  /** The sport chosen, or undefined for all sports. */
  onSelect: (type: string | undefined) => void;
}

const NONE: ReadonlySet<string> = new Set();

export function SportFilterChips({ options, selectedType, onSelect }: SportFilterChipsProps) {
  // A selected sport the options no longer carry keeps its chip, so it can be cleared.
  const listed =
    selectedType === undefined || options.includes(selectedType)
      ? options
      : [selectedType, ...options];

  return (
    <View style={styles.row}>
      <SportChipRow
        chips={listed.map((type) => ({
          key: type,
          label: `activityTypes.${type}`,
          testID: `sport-filter-chip-${type}`,
        }))}
        selected={selectedType === undefined ? NONE : new Set([selectedType])}
        onToggle={(type) => onSelect(type === selectedType ? undefined : type)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: spacing.md },
});
