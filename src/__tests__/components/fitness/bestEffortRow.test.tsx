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

jest.mock('@/features/stats/hooks/useBestEfforts', () => ({
  useBestEfforts: () => ({
    data: {
      sports: [
        {
          sport: 'Swim',
          fetched: true,
          // Kind 1 is `BestEffortKind.Distance`.
          efforts: [
            {
              kind: 1,
              checkpoint: 3800,
              value: 0.7,
              time: 5565,
              activityId: 'long-swim',
              activity: { activityId: 'long-swim', name: 'Lake crossing', date: 1_772_524_800 },
            },
            { kind: 1, checkpoint: 400, value: 1.2, time: 333 },
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
  it('sizes its columns from content and keeps the value whole', async () => {
    await render(
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

  it('opens its activity from the whole row and states its date', async () => {
    const push = jest.spyOn(require('expo-router').router, 'push').mockImplementation(() => {});
    await render(
      <BestEffortRow
        testID="row"
        label="5K"
        value="4:10 /km"
        valueColor="#000"
        isLast={false}
        activity={{ id: 'reef-run', name: 'Reef loop', date: '9 Jan' }}
      />
    );

    expect(screen.getByText('9 Jan')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: '5K, 4:10 /km, Reef loop, 9 Jan' }));
    expect(push).toHaveBeenCalledWith('/activity/reef-run');
    push.mockRestore();
  });
});

describe('the three surfaces that draw a best', () => {
  it('draw Best Efforts rows with no fixed column', async () => {
    await render(<BestEffortsScreen />);

    expectNoFixedWidth(screen.getByTestId('best-efforts-row-Swimming-3800'));
    expectNoFixedWidth(screen.getByTestId('best-efforts-row-Swimming-400'));
  });

  it('draw Season Bests rows with no fixed column', async () => {
    await render(
      <SeasonBestsSection
        efforts={
          [
            { label: '3.8km', checkpoint: 3800, activityId: 'long-swim', value: 0.7, time: 5565 },
          ] as never
        }
        sport="Swimming"
        period="6m"
        isLoading={false}
      />
    );

    expectNoFixedWidth(screen.getByTestId('season-bests-row-3800'));
  });

  it('draw climbing rows with no fixed column', async () => {
    const bests = [
      { label: '60m', windowS: 3600, vam: 1250, wattsPerKg: 3.4, activityId: 'long-swim' },
    ] as ClimbBest[];
    await render(<ClimbingBestRows bests={bests} />);

    expectNoFixedWidth(screen.getByTestId('season-bests-climbing-3600'));
  });
});
