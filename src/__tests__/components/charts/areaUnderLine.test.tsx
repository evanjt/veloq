/**
 * Expected behaviour: an area under a chart line is a flat wash of the line's
 * colour at a tint step, drawn only when the axis starts at zero. A line on a
 * raised axis is a bare line, with no fade and no fill to the plot floor.
 */

import React from 'react';
import { fireEvent, render, type RenderResult } from '@testing-library/react-native';
import { Path, LinearGradient, Skia } from '@shopify/react-native-skia';
import type { ReactTestInstance } from 'react-test-renderer';

import { CurveArea } from '@/shared/charts';
import { FTPTrendChart } from '@/features/stats/components/FTPTrendChart';
import { FitnessChart } from '@/features/fitness/components/FitnessChart';
import { opacity } from '@/theme';
import type { WellnessData } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

const LINE = '#3366cc';
const POINTS = [
  { x: 0, y: 80 },
  { x: 50, y: 40 },
  { x: 100, y: 60 },
];

beforeEach(() => {
  // The shared mock parses no path, so every area would draw nothing whatever its domain.
  jest
    .spyOn(Skia.Path, 'MakeFromSVGString')
    .mockImplementation(
      (d: string) => ({ d }) as unknown as ReturnType<typeof Skia.Path.MakeFromSVGString>
    );
});

afterEach(() => jest.restoreAllMocks());

function filledPaths(tree: RenderResult): ReactTestInstance[] {
  return tree.UNSAFE_getAllByType(Path).filter((node) => node.props.style === 'fill');
}

async function layOut(tree: RenderResult) {
  const measured = tree.UNSAFE_root.findAll(
    (node) => typeof node.type === 'string' && typeof node.props.onLayout === 'function'
  );
  for (const node of measured) {
    await fireEvent(node, 'layout', { nativeEvent: { layout: { width: 320, height: 200 } } });
  }
}

describe('CurveArea', () => {
  it('draws nothing on a raised axis', async () => {
    const tree = await render(
      <CurveArea points={POINTS} yDomain={[240, 266]} y0={100} color={LINE} isDark={false} />
    );
    expect(tree.UNSAFE_queryAllByType(Path)).toHaveLength(0);
  });

  it('draws one flat path in the line colour at the light tint step on a zero-based axis', async () => {
    const tree = await render(
      <CurveArea points={POINTS} yDomain={[0, 400]} y0={100} color={LINE} isDark={false} />
    );
    const paths = filledPaths(tree);
    expect(paths).toHaveLength(1);
    expect(paths[0]!.props.color).toBe(LINE);
    expect(paths[0]!.props.opacity).toBe(opacity.tint1);
    expect(tree.UNSAFE_queryAllByType(LinearGradient)).toHaveLength(0);
  });

  it('reads the dark tint step in dark mode', async () => {
    const tree = await render(
      <CurveArea points={POINTS} yDomain={[0, 400]} y0={100} color={LINE} isDark />
    );
    expect(filledPaths(tree)[0]!.props.opacity).toBe(opacity.tint2);
  });
});

describe('the eFTP trend', () => {
  it('draws no area under a line from 240 to 266 W', async () => {
    const tree = await render(
      <FTPTrendChart
        data={[
          { date: '2026-07-01', eftp: 240 },
          { date: '2026-08-01', eftp: 252 },
          { date: '2026-09-01', eftp: 266 },
        ]}
      />
    );
    await layOut(tree);
    expect(filledPaths(tree)).toHaveLength(0);
    expect(tree.UNSAFE_queryAllByType(LinearGradient)).toHaveLength(0);
  });
});

describe('the fitness chart', () => {
  it('draws one flat wash under fitness on its zero-based axis', async () => {
    const days = [
      { id: '2026-04-01', ctl: 40, atl: 48 },
      { id: '2026-04-02', ctl: 41, atl: 49 },
      { id: '2026-04-03', ctl: 43, atl: 55 },
    ] as WellnessData[];
    const tree = await render(<FitnessChart data={days} />);
    await layOut(tree);
    const paths = filledPaths(tree);
    expect(paths).toHaveLength(1);
    expect(paths[0]!.props.opacity).toBe(opacity.tint1);
    expect(tree.UNSAFE_queryAllByType(LinearGradient)).toHaveLength(0);
  });
});
