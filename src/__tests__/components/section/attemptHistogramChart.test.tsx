/**
 * Scenario: the attempt histogram draws the engine's bins as capped rounded bars on a
 * zero-based count axis, with a dashed record line and a solid line for this activity.
 * Expected behaviour: a key row names a line only when that line is drawn; the bars, grid,
 * record and this activity read their chart tokens in the theme on screen; no text is below
 * the 12 px chart label; and the plot speaks a summary, offers Show data and steps bin by bin
 * with a readout of the bin's range and count.
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { act, render, within } from '@testing-library/react-native';
import { DashPathEffect, Line, RoundedRect } from '@shopify/react-native-skia';

import { AttemptHistogramChart } from '@/features/routes/components/section/AttemptHistogramChart';
import { GRID_DASH } from '@/shared/charts';
import { colourTokens } from '@/theme';
import type { FfiAttemptHistogram } from 'veloqrs';
import { layoutViews } from '../../__shared__/layoutViews';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());

let mockScheme: 'light' | 'dark' = 'light';
jest.mock('@/shared/app/ThemeProvider', () => ({
  ...jest.requireActual('@/shared/app/ThemeProvider'),
  useResolvedColorScheme: () => mockScheme,
}));
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: mockScheme === 'dark' }),
}));

afterEach(() => {
  mockScheme = 'light';
  jest.restoreAllMocks();
});

const SIX_BINS: FfiAttemptHistogram = {
  startSecs: 300,
  binWidthSecs: 30,
  counts: [1, 4, 6, 3, 2, 1],
  binned: 17,
  unbinnedOutsideBand: 0,
};

/** The props of every render of a Skia primitive, so a test reads what was drawn. */
function capture(primitive: unknown) {
  const drawn: Record<string, unknown>[] = [];
  const target = primitive as {
    render: (props: Record<string, unknown>, ref: unknown) => React.ReactNode;
  };
  const original = target.render;
  jest.spyOn(target, 'render').mockImplementation((props, ref) => {
    drawn.push(props);
    return original(props, ref);
  });
  return drawn;
}

const isDashed = (line: Record<string, unknown>, intervals?: number[]) =>
  React.Children.toArray(line.children as React.ReactNode).some(
    (child) =>
      React.isValidElement(child) &&
      child.type === DashPathEffect &&
      (intervals === undefined ||
        JSON.stringify((child.props as { intervals: number[] }).intervals) ===
          JSON.stringify(intervals))
  );

type XY = { x: number; y: number };
const p1 = (l: Record<string, unknown>) => l.p1 as XY;
const p2 = (l: Record<string, unknown>) => l.p2 as XY;
const vertical = (l: Record<string, unknown>) => p1(l).x === p2(l).x && p1(l).y !== p2(l).y;
const horizontal = (l: Record<string, unknown>) => p1(l).y === p2(l).y;

async function draw(props: Partial<React.ComponentProps<typeof AttemptHistogramChart>> = {}) {
  const tree = await render(
    <AttemptHistogramChart
      histogram={SIX_BINS}
      activityType="Ride"
      isDark={mockScheme === 'dark'}
      useTimeAxis
      {...props}
    />
  );
  await layoutViews(tree, 400, 300);
  return tree;
}

describe('the attempt histogram key', () => {
  it('names no record when there is no record time', async () => {
    const tree = await draw({ recordTime: null });
    expect(tree.queryByTestId('attempt-histogram-record-key')).toBeNull();
  });

  it('names no record when the record falls outside the bins', async () => {
    const tree = await draw({ recordTime: 1200 });
    expect(tree.queryByTestId('attempt-histogram-record-key')).toBeNull();
  });

  it('names the record when its line is drawn', async () => {
    const tree = await draw({ recordTime: 310 });
    expect(tree.getByTestId('attempt-histogram-record-key')).toHaveTextContent('sections.best');
  });

  it('names this activity only when its line is drawn', async () => {
    expect(
      (await draw({ highlightedTime: null })).queryByTestId('attempt-histogram-highlight-key')
    ).toBeNull();
    expect(
      (await draw({ highlightedTime: 1200 })).queryByTestId('attempt-histogram-highlight-key')
    ).toBeNull();
    expect(
      (await draw({ highlightedTime: 340 })).getByTestId('attempt-histogram-highlight-key')
    ).toHaveTextContent('sections.legendThisActivity');
  });

  it('gives each drawn line a row of its own', async () => {
    const tree = await draw({ recordTime: 310, highlightedTime: 340 });
    const key = tree.getByTestId('attempt-histogram-key');
    expect(within(key).getByTestId('attempt-histogram-record-key')).toBeTruthy();
    expect(within(key).getByTestId('attempt-histogram-highlight-key')).toBeTruthy();
    expect(StyleSheet.flatten(key.props.style).flexDirection ?? 'column').toBe('column');
  });
});

describe.each(['light', 'dark'] as const)('the attempt histogram marks, %s', (scheme) => {
  const tokens = colourTokens[scheme];
  beforeEach(() => {
    mockScheme = scheme;
  });

  it('draws capped rounded bars in the series colour', async () => {
    const bars = capture(RoundedRect);
    await draw();

    const plotted = bars.filter((b) => b.color === tokens['chart-series']);
    expect(plotted).toHaveLength(6);
    for (const bar of plotted) {
      expect(Number(bar.width)).toBeLessThanOrEqual(24);
      expect(Number(bar.r)).toBeGreaterThan(0);
    }
  });

  it('draws gridlines in the grid token and the baseline in the axis token', async () => {
    const lines = capture(Line);
    await draw();

    const across = lines.filter(horizontal);
    const grid = across.filter((l) => isDashed(l, GRID_DASH));
    expect(grid.length).toBeGreaterThan(0);
    for (const line of grid) expect(line.color).toBe(tokens['chart-grid']);
    expect(across.some((l) => !isDashed(l) && l.color === tokens['chart-axis'])).toBe(true);
  });

  it('draws the record dashed in the achievement text colour and this activity solid in ink', async () => {
    const lines = capture(Line);
    await draw({ recordTime: 310, highlightedTime: 340 });

    const marks = lines.filter(vertical);
    const record = marks.filter((l) => l.color === tokens['achievement-text']);
    const attempt = marks.filter((l) => l.color === tokens['text-primary']);
    expect(record).toHaveLength(1);
    expect(attempt).toHaveLength(1);
    expect(isDashed(record[0])).toBe(true);
    expect(isDashed(attempt[0])).toBe(false);
  });
});

describe('the attempt histogram text', () => {
  it('sets no text below the 12 px chart label', async () => {
    const tree = await draw({ recordTime: 310, highlightedTime: 340 });
    const sizes = tree
      .UNSAFE_getAllByType(Text)
      .map((node) => StyleSheet.flatten(node.props.style)?.fontSize as number | undefined)
      .filter((size): size is number => size !== undefined);
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) expect(size).toBeGreaterThanOrEqual(12);
  });

  it('labels the count axis from zero in a gutter beside the plot', async () => {
    const tree = await draw();
    const labels = tree.queryAllByTestId(/^attempt-histogram-y-axis-\d+$/);
    expect(labels.map((n) => n.props.children)[0]).toBe('0');
  });
});

describe('the attempt histogram surface', () => {
  it('speaks a summary and offers Show data', async () => {
    const tree = await draw();
    const surface = tree.getByTestId('attempt-histogram-plot');
    expect(surface.props.accessibilityRole).toBe('image');
    expect(surface.props.accessibilityLabel).toContain('sections.viewSpread');
    expect(tree.getByTestId('attempt-histogram-plot-show-data')).toBeTruthy();
  });

  it("steps bin by bin and reads out the bin's range and count", async () => {
    const tree = await draw();
    const scrub = tree.getByTestId('attempt-histogram-scrub');
    expect(scrub.props.accessibilityRole).toBe('adjustable');

    const step = async () =>
      act(() => scrub.props.onAccessibilityAction({ nativeEvent: { actionName: 'increment' } }));
    await step();
    await step();

    const readout = tree.getByTestId('attempt-histogram-readout');
    expect(readout).toHaveTextContent(/5:30.*6:00/);
    expect(readout).toHaveTextContent(/"count":4/);
    expect(tree.getByTestId('attempt-histogram-scrub').props.accessibilityValue.text).toMatch(
      /5:30.*6:00.*"count":4/
    );
  });
});
