/**
 * Scenario: the feed opens scrolled down by a fixed search-section height that
 * assumes one chip line. The 2026-09-11 spacing sweep took the chip padding from
 * 14 to 16, the four chips stopped fitting 360 dp, and the row wrapped: Cycling,
 * Running and Swimming scrolled out of view and the feed opened showing Other
 * alone.
 *
 * Expected behaviour: the row is a horizontal scroller and never wraps, whatever
 * the width, the translation or the font scale.
 */
import React from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { FeedFilterChips } from '@/features/activity/components/FeedFilterChips';
import type { FeedGroup } from '@/features/activity/lib/feedActivityGroups';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

function renderChips() {
  return render(
    <FeedFilterChips
      selected={new Set()}
      onSelect={jest.fn()}
      selectedRange={null}
      onSelectRange={jest.fn()}
    />
  );
}

describe('feed filter chips', () => {
  it('draws every sport chip', async () => {
    await renderChips();

    for (const testID of [
      'home-filter-ride',
      'home-filter-run',
      'home-filter-water',
      'home-filter-other',
    ]) {
      expect(screen.getByTestId(testID)).toBeTruthy();
    }
  });

  it('lays the chips out in one horizontal scroller rather than wrapping', async () => {
    const { UNSAFE_getByType } = await renderChips();
    const scroller = UNSAFE_getByType(ScrollView);

    expect(scroller.props.horizontal).toBe(true);

    const row = StyleSheet.flatten(scroller.props.contentContainerStyle);
    expect(row.flexDirection).toBe('row');
    expect(row.flexWrap).toBeUndefined();
  });

  it('lets two sport chips stay selected together', async () => {
    const selected = new Set<FeedGroup>(['Ride', 'Other']);
    const onSelect = jest.fn();
    await render(
      <FeedFilterChips
        selected={selected}
        onSelect={onSelect}
        selectedRange={null}
        onSelectRange={jest.fn()}
      />
    );
    expect(screen.getByTestId('home-filter-ride').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('home-filter-other').props.accessibilityState.selected).toBe(true);
    await fireEvent.press(screen.getByTestId('home-filter-run'));
    expect(onSelect).toHaveBeenCalledWith('Run');
  });
});
