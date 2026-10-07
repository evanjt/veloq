import React from 'react';
import { useTranslation } from 'react-i18next';
import { spacing, typography } from '@/theme';
import { SportChipRow } from '@/shared/ui/SportChipRow';
import { ToggleButton } from '@/shared/ui';
import { FEED_GROUPS, type FeedGroup } from '../lib/feedActivityGroups';
import { FEED_RANGE_PRESETS, type FeedRangePreset } from '../lib/feedRange';

const RANGE_LABELS = {
  last90Days: 'feed.range.last90Days',
  thisYear: 'feed.range.thisYear',
  lastYear: 'feed.range.lastYear',
} as const satisfies Record<FeedRangePreset, string>;

export const FEED_CHIP_HEIGHT = typography.bodySmall.lineHeight + spacing.xs * 2;

const FEED_TEST_IDS: Record<FeedGroup, { testID: string }> = {
  Cycling: { testID: 'home-filter-cycling' },
  Running: { testID: 'home-filter-running' },
  Swimming: { testID: 'home-filter-swimming' },
  Other: { testID: 'home-filter-other' },
};

interface FeedFilterChipsProps {
  selected: ReadonlySet<FeedGroup>;
  onSelect: (group: FeedGroup) => void;
  selectedRange: FeedRangePreset | null;
  onSelectRange: (preset: FeedRangePreset) => void;
  isDark: boolean;
}

export function FeedFilterChips({
  selected,
  onSelect,
  selectedRange,
  onSelectRange,
  isDark,
}: FeedFilterChipsProps) {
  const { t } = useTranslation();
  return (
    <SportChipRow
      chips={FEED_GROUPS.map((group) => ({
        key: group,
        label: `feed.groups.${group.toLowerCase()}`,
        testID: FEED_TEST_IDS[group].testID,
      }))}
      selected={selected}
      onToggle={(key) => onSelect(key as FeedGroup)}
      isDark={isDark}
    >
      {FEED_RANGE_PRESETS.map((preset) => (
        <ToggleButton
          key={preset}
          testID={`home-range-${preset}`}
          label={t(RANGE_LABELS[preset])}
          selected={selectedRange === preset}
          onPress={() => onSelectRange(preset)}
        />
      ))}
    </SportChipRow>
  );
}
