import React from 'react';
import { useTranslation } from 'react-i18next';
import { SportChipRow } from '@/shared/ui/SportChipRow';
import { ToggleButton } from '@/shared/ui';
import { FEED_GROUPS, FEED_GROUP_LABELS, type FeedGroup } from '../lib/feedActivityGroups';
import { FEED_RANGE_LABELS, FEED_RANGE_PRESETS, type FeedRangePreset } from '../lib/feedRange';

const FEED_TEST_IDS: Record<FeedGroup, { testID: string }> = {
  Ride: { testID: 'home-filter-ride' },
  Winter: { testID: 'home-filter-winter' },
  Run: { testID: 'home-filter-run' },
  Water: { testID: 'home-filter-water' },
  Foot: { testID: 'home-filter-foot' },
  Strength: { testID: 'home-filter-strength' },
  Other: { testID: 'home-filter-other' },
};

interface FeedFilterChipsProps {
  selected: ReadonlySet<FeedGroup>;
  onSelect: (group: FeedGroup) => void;
  selectedRange: FeedRangePreset | null;
  onSelectRange: (preset: FeedRangePreset) => void;
}

export function FeedFilterChips({
  selected,
  onSelect,
  selectedRange,
  onSelectRange,
}: FeedFilterChipsProps) {
  const { t } = useTranslation();
  return (
    <SportChipRow
      chips={FEED_GROUPS.map((group) => ({
        key: group,
        label: FEED_GROUP_LABELS[group],
        testID: FEED_TEST_IDS[group].testID,
      }))}
      selected={selected}
      onToggle={(key) => onSelect(key as FeedGroup)}
    >
      {FEED_RANGE_PRESETS.map((preset) => (
        <ToggleButton
          key={preset}
          testID={`home-range-${preset}`}
          label={t(FEED_RANGE_LABELS[preset])}
          selected={selectedRange === preset}
          onPress={() => onSelectRange(preset)}
        />
      ))}
    </SportChipRow>
  );
}
