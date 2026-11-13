/**
 * Scenario: each chart drew its lines, dots and bars at its own sizes. Lines
 * ran from 0.75 to 2.5px with mitred joins, a scrub drew a dot on the series in
 * one chart and nothing in the rest, bars ran square and as wide as the gap,
 * and a record was a halo of whatever colour the caller passed.
 *
 * Expected behaviour: one mark set. A 2px round-joined line, an 8px dot in a
 * 2px surface ring on every scrubbed line, bars capped at 24px with rounded
 * ends, and the record a gold ring.
 */

import React from 'react';
import { StyleSheet, View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Circle, Path, RoundedRect, Skia } from '@shopify/react-native-skia';

import { FitnessChart } from '@/features/fitness/components/FitnessChart';
import { CurveChart } from '@/shared/charts/CurveChart';
import { CurveLine } from '@/shared/charts/CurvePaths';
import { RankRing } from '@/shared/charts/RankRing';
import { colors, colourTokens } from '@/theme';
import type { WellnessData } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

type Tree = Awaited<ReturnType<typeof render>>;

const DAYS = [
  { id: '2026-04-01', ctl: 40, atl: 48 },
  { id: '2026-04-02', ctl: 41, atl: 49 },
  { id: '2026-04-03', ctl: 43, atl: 55 },
] as WellnessData[];

const light = colourTokens.light;

async function layOut(tree: Tree) {
  for (const node of tree.UNSAFE_getAllByType(View).filter((n) => n.props.onLayout)) {
    await act(async () => {
      await fireEvent(node, 'layout', { nativeEvent: { layout: { width: 360, height: 240 } } });
    });
  }
}

const circles = (tree: Tree) => tree.UNSAFE_queryAllByType(Circle).map((c) => c.props);

let pathSpy: jest.SpyInstance;
beforeEach(() => {
  // The mock parses no path, so a line would draw nothing to inspect.
  pathSpy = jest
    .spyOn(Skia.Path, 'MakeFromSVGString')
    .mockImplementation(((d: string) => ({ d })) as never);
});
afterEach(() => pathSpy.mockRestore());

describe('a chart line', () => {
  it('is drawn at 2px with round joins and caps', async () => {
    const tree = await render(
      <CurveLine
        points={[
          { x: 0, y: 0 },
          { x: 10, y: 20 },
          { x: 20, y: 0 },
        ]}
        color={colors.fitness}
      />
    );
    const path = tree.UNSAFE_getByType(Path).props;
    expect(path.strokeWidth).toBe(2);
    expect(path.strokeJoin).toBe('round');
    expect(path.strokeCap).toBe('round');
  });
});

describe('the fitness chart after a scrub', () => {
  it('marks the scrubbed day with a ringed dot on both lines', async () => {
    const tree = await render(<FitnessChart data={DAYS} />);
    await layOut(tree);
    const fills = () => circles(tree).filter((c) => c.r === 4);
    expect(fills()).toHaveLength(0);

    const surface = tree.getByTestId('fitness-chart-surface');
    await act(async () => {
      await fireEvent(surface, 'accessibilityAction', {
        nativeEvent: { actionName: 'increment' },
      });
    });

    const dots = fills();
    expect(dots.map((d) => d.color).sort()).toEqual([colors.fatigue, colors.fitness].sort());
    expect(dots[0].cx).toBe(dots[1].cx);
    const rings = circles(tree).filter((c) => c.r === 6);
    expect(rings).toHaveLength(2);
    for (const ring of rings) expect(ring.color).toBe(light.surface);
  });
});

describe('a curve chart', () => {
  const data = [
    { x: 0, y: 10 },
    { x: 1, y: 30 },
    { x: 2, y: 20 },
  ];
  const reading = {
    title: 'Watts',
    xHeader: 'Day',
    formatX: String,
    shape: 'series' as const,
  };
  const props = {
    data,
    yDomain: [0, 40] as [number, number],
    color: colors.fitness,
    xLabels: [],
    formatY: String,
    reading,
  };

  it('rings a record in gold, in place of a halo in the series colour', async () => {
    const tree = await render(<CurveChart {...props} marker={{ index: 1, kind: 'record' }} />);
    await layOut(tree);
    const ring = circles(tree).find((c) => c.style === 'stroke');
    expect(ring).toBeDefined();
    expect(ring!.color).toBe(light.achievement);
    expect(ring!.strokeWidth).toBe(2);
    expect(circles(tree).some((c) => c.color === colors.fitness && c.r > 4)).toBe(false);
  });

  it('draws sparse bars no wider than 24px, with rounded ends', async () => {
    const tree = await render(<CurveChart {...props} bars />);
    await layOut(tree);
    const bars = tree.UNSAFE_queryAllByType(RoundedRect).map((b) => b.props);
    expect(bars).toHaveLength(3);
    for (const bar of bars) {
      expect(bar.width).toBe(24);
      expect(bar.r).toBe(4);
    }
  });
});

describe('second and third place', () => {
  it('is a ring in the reference colour with its place beside it, never a medal tone', async () => {
    for (const isDark of [false, true]) {
      const tree = await render(<RankRing rank={2} isDark={isDark} testID="place" />);
      const ring = StyleSheet.flatten(tree.getByTestId('place-ring').props.style);
      expect(ring.borderColor).toBe(colourTokens[isDark ? 'dark' : 'light']['chart-reference']);
      expect(ring.borderWidth).toBe(2);
      expect(tree.getByText('2')).toBeTruthy();
    }
  });
});
