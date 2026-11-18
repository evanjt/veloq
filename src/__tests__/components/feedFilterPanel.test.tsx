/**
 * Scenario: the feed's filter panel is open over a library of known span, or shut
 * with filters set.
 *
 * Expected behaviour: open, it draws a bar each for date, distance and duration and
 * a step on a handle commits a range; shut, it names each set filter in a chip whose
 * cross clears that filter alone, and it draws nothing when none is set.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { FeedFilterPanel } from '@/features/activity/components/FeedFilterPanel';
import type { FeedFilter } from '@/features/activity/lib/feedFilter';

const SPAN = {
  oldestTs: Date.UTC(2024, 0, 1) / 1000,
  newestTs: Date.UTC(2026, 0, 1) / 1000,
  minDistance: 1_000,
  maxDistance: 101_000,
  minMovingTime: 600,
  maxMovingTime: 36_600,
};

const NONE: FeedFilter = {
  searchText: '',
  groups: new Set(),
  range: null,
  distance: null,
  duration: null,
};

function renderPanel(filter: FeedFilter, expanded: boolean) {
  const handlers = {
    onExpand: jest.fn(),
    onCollapse: jest.fn(),
    onRange: jest.fn(),
    onDistance: jest.fn(),
    onDuration: jest.fn(),
    onToggleGroup: jest.fn(),
    onClearName: jest.fn(),
  };
  render(
    <FeedFilterPanel
      filter={filter}
      span={SPAN}
      expanded={expanded}
      matchedCount={7}
      {...handlers}
    />
  );
  return handlers;
}

async function measure(testID: string) {
  await fireEvent(screen.getByTestId(testID), 'layout', {
    nativeEvent: { layout: { x: 0, y: 0, width: 300, height: 28 } },
  });
}

describe('the open panel', () => {
  it('draws a bar for date, distance and duration with the sport chips', async () => {
    await renderPanel(NONE, true);
    for (const id of ['home-filter-date', 'home-filter-distance', 'home-filter-duration']) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    expect(screen.getByTestId('home-filter-run')).toBeTruthy();
    expect(screen.getByTestId('home-range-last90Days')).toBeTruthy();
  });

  it('commits a distance range after a step on a handle, and none while untouched', async () => {
    const { onDistance } = await renderPanel(NONE, true);
    await measure('home-filter-distance-bar');

    await fireEvent(
      screen.getByTestId('home-filter-distance-bar-start-handle'),
      'accessibilityAction',
      { nativeEvent: { actionName: 'increment' } }
    );

    expect(onDistance).toHaveBeenCalledTimes(1);
    const range = onDistance.mock.calls[0][0];
    expect(range.low).toBeGreaterThan(1_000);
    expect(range.high).toBe(101_000);
  });

  it('keeps a handle at the library end from stepping past it', async () => {
    const { onDuration } = await renderPanel(NONE, true);
    await measure('home-filter-duration-bar');

    await fireEvent(
      screen.getByTestId('home-filter-duration-bar-end-handle'),
      'accessibilityAction',
      { nativeEvent: { actionName: 'increment' } }
    );

    expect(onDuration).not.toHaveBeenCalled();
  });
});

describe('the shut panel', () => {
  it('draws nothing while no filter is set', async () => {
    await renderPanel(NONE, false);
    expect(screen.queryByTestId('home-filter-panel')).toBeNull();
  });

  it('names each filter in a chip with the count beside them', async () => {
    await renderPanel(
      {
        ...NONE,
        distance: { low: 20_000, high: 60_000 },
        duration: { low: 3_600, high: 10_800 },
        groups: new Set(['Ride'] as const),
      },
      false
    );
    for (const id of [
      'home-filter-chip-distance',
      'home-filter-chip-duration',
      'home-filter-chip-sport-ride',
    ]) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
    expect(screen.queryByTestId('home-filter-chip-date')).toBeNull();
    expect(screen.getByTestId('home-filter-count')).toBeTruthy();
  });

  it('clears only the filter whose cross is pressed', async () => {
    const handlers = await renderPanel(
      { ...NONE, distance: { low: 20_000, high: 60_000 }, searchText: 'hill' },
      false
    );

    await fireEvent.press(screen.getByTestId('home-filter-chip-distance-clear'));
    expect(handlers.onDistance).toHaveBeenCalledWith(null);
    expect(handlers.onClearName).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('home-filter-chip-name-clear'));
    expect(handlers.onClearName).toHaveBeenCalledTimes(1);
  });

  it('reopens the panel from a chip', async () => {
    const handlers = await renderPanel({ ...NONE, searchText: 'hill' }, false);
    await fireEvent.press(screen.getByTestId('home-filter-chip-name'));
    expect(handlers.onExpand).toHaveBeenCalledTimes(1);
  });
});
