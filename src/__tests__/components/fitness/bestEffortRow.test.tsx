/**
 * Scenario: Best Efforts, Season Bests and the climbing rows each drew a best
 * in a 48 dp label column and a 100 dp value column. At a large system text
 * size a time such as 1:32:45 in bold no longer fits 100 dp, so it wrapped
 * mid-value or ran into the activity name.
 *
 * Expected behaviour: one row draws a best on all three surfaces, and its
 * columns size from their content: no column carries a fixed width, the value
 * column never shrinks below its value, and the value uses tabular figures.
 */

import React from 'react';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import BestEffortsScreen from '@/app/best-efforts';
import { BestEffortRow } from '@/features/fitness/components/BestEffortRow';
import { ClimbingBestRows } from '@/features/fitness/components/ClimbingBestRows';
import { SeasonBestsSection } from '@/features/fitness/components/SeasonBestsSection';
import type { ClimbBest } from '@/features/stats';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useScreenSafeAreaEdges: () => [],
}));

jest.mock('@/features/activity', () => ({
  useActivityLabels: () => ({
    labels: new Map([['long-swim', { name: 'Lake crossing', date: '3 Mar' }]]),
    error: null,
  }),
}));

jest.mock('@/features/stats/hooks/useBestEfforts', () => ({
  useBestEfforts: () => ({
    data: {
      sports: [
        {
          sport: 'Swim',
          fetched: true,
          efforts: [
            { label: '3.8km', checkpoint: 3800, value: 0.7, time: 5565, activityId: 'long-swim' },
            { label: '400m', checkpoint: 400, value: 1.2, time: 333 },
          ],
        },
      ],
      climbing: [],
    },
    isLoading: false,
    error: null,
    curves: { Swim: { fetched: true, status: 'idle', retry: jest.fn() } },
  }),
}));

/** Every host element under a row, with its flattened style. */
function stylesUnder(row: ReactTestInstance): (ViewStyle & TextStyle)[] {
  const out: (ViewStyle & TextStyle)[] = [];
  const walk = (node: ReactTestInstance | string) => {
    if (typeof node === 'string') return;
    if (typeof node.type === 'string') {
      out.push((StyleSheet.flatten(node.props.style) ?? {}) as ViewStyle & TextStyle);
    }
    node.children.forEach(walk);
  };
  walk(row);
  return out;
}

function expectNoFixedWidth(row: ReactTestInstance) {
  const widths = stylesUnder(row)
    .map((style) => style.width)
    .filter((width) => typeof width === 'number');
  expect(widths).toEqual([]);
}

describe('BestEffortRow', () => {
  it('sizes its columns from content and keeps the value whole', () => {
    render(
      <BestEffortRow
        testID="row"
        label="Ironman"
        value="1:32:45"
        secondary="0:57 /100m"
        valueColor="#000"
        isLast
      />
    );

    expectNoFixedWidth(screen.getByTestId('row'));

    const value = StyleSheet.flatten(screen.getByText('1:32:45', { exact: true }).props.style);
    expect(value.fontVariant).toContain('tabular-nums');

    const valueColumn = screen.getByTestId('row-value');
    expect(StyleSheet.flatten(valueColumn.props.style).flexShrink).toBe(0);
  });

  it('opens its target from the whole row when it has one', () => {
    const onPress = jest.fn();
    render(
      <BestEffortRow
        testID="row"
        label="5K"
        value="4:10 /km"
        valueColor="#000"
        isLast={false}
        onPress={onPress}
        accessibilityLabel="5K"
      />
    );

    fireEvent.press(screen.getByRole('button', { name: '5K' }));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('the three surfaces that draw a best', () => {
  it('draw Best Efforts rows with no fixed column', () => {
    render(<BestEffortsScreen />);

    expectNoFixedWidth(screen.getByTestId('best-efforts-row-Swimming-3.8km'));
    expectNoFixedWidth(screen.getByTestId('best-efforts-row-Swimming-400m'));
  });

  it('draw Season Bests rows with no fixed column', () => {
    render(
      <SeasonBestsSection
        efforts={[{ label: '3.8km', activityId: 'long-swim', value: 0.7, time: 5565 }] as never}
        sport="Swimming"
        isLoading={false}
      />
    );

    expectNoFixedWidth(screen.getByTestId('season-bests-row-3.8km'));
  });

  it('draw climbing rows with no fixed column', () => {
    const bests = [
      { label: '60m', windowS: 3600, vam: 1250, wattsPerKg: 3.4, activityId: 'long-swim' },
    ] as ClimbBest[];
    render(<ClimbingBestRows bests={bests} sport="Running" />);

    expectNoFixedWidth(screen.getByTestId('season-bests-climbing-3600'));
  });
});
