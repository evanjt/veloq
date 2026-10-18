import React from 'react';
import { StyleSheet } from 'react-native';
import { SportChipRow, type SportChip } from '@/shared/ui/SportChipRow';
import type { PrimarySport } from '@/features/fitness/stores';
import { spacing } from '@/theme';

/** Each sport's chip, its dot in its family's colour. */
const SPORT_CHIPS = [
  {
    key: 'Cycling',
    category: 'Ride',
    label: 'filters.cycling',
    testID: 'fitness-sport-toggle-Cycling',
  },
  {
    key: 'Running',
    category: 'Run',
    label: 'filters.running',
    testID: 'fitness-sport-toggle-Running',
  },
  {
    key: 'Swimming',
    category: 'Water',
    label: 'filters.swimming',
    testID: 'fitness-sport-toggle-Swimming',
  },
] as const satisfies readonly SportChip[];

interface SportToggleSelectorProps {
  sportMode: PrimarySport;
  onSportModeChange: (sport: PrimarySport) => void;
}

/** Chip row for selecting the active fitness sport (Cycling/Running/Swimming). */
export const SportToggleSelector = React.memo(function SportToggleSelector({
  sportMode,
  onSportModeChange,
}: SportToggleSelectorProps) {
  return (
    <SportChipRow
      chips={SPORT_CHIPS}
      value={sportMode}
      onSelect={(key) => onSportModeChange(key as PrimarySport)}
      style={styles.row}
    />
  );
});

const styles = StyleSheet.create({
  row: { marginBottom: spacing.md },
});
