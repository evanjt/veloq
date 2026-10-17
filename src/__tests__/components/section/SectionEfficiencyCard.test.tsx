/**
 * Scenario: the aerobic efficiency series the performance read carries for a
 * section or a route.
 * Expected behaviour: the card plots the series it was given and stays off
 * screen when the read has none.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { Canvas, Circle, Path } from '@shopify/react-native-skia';
import {
  SectionEfficiencyCard,
  efficiencySeriesVertices,
} from '@/features/routes/components/section/SectionEfficiencyCard';
import type { EfficiencyTrend } from 'veloqrs';
import { colors, darkColors, verdictColor } from '@/theme';
import { layoutViews } from '../../__shared__/layoutViews';

// The binding registers a TurboModule at import time. A hook on this screen's
// import path compares against one of its generated enums, so the stub is the
// module here.
jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}));

const DAY = 86_400;

function point(ratio: number, date = 1) {
  return {
    date,
    paceSecsPerKm: 240,
    avgHr: 150,
    hrPaceRatio: ratio,
  };
}

function trend(overrides: Partial<EfficiencyTrend> = {}): EfficiencyTrend {
  return {
    sectionId: 'sec-1',
    sectionName: 'Church Hill',
    sportType: 'Ride',
    points: [point(0.64, DAY), point(0.62, 2 * DAY), point(0.59, 3 * DAY)],
    trendSlope: -0.0004,
    direction: 0,
    hrChangeBpm: -6.2,
    effortCount: 3,
    ...overrides,
  } as EfficiencyTrend;
}

it('renders the effort count and the HR change the engine measured', async () => {
  const { getByTestId } = await render(<SectionEfficiencyCard trend={trend()} isDark={false} />);

  expect(getByTestId('section-efficiency-card')).toBeTruthy();
  expect(getByTestId('section-efficiency-detail').props.children).toContain('3');
  expect(getByTestId('section-efficiency-detail').props.children).toContain('-6');
});

it('renders the chart for a section that has a series', async () => {
  const { getByTestId } = await render(<SectionEfficiencyCard trend={trend()} isDark={false} />);

  expect(getByTestId('section-efficiency-chart')).toBeTruthy();
});

it('titles the card as a heading', async () => {
  const { getByRole } = await render(<SectionEfficiencyCard trend={trend()} isDark={false} />);

  expect(getByRole('header', { name: 'sections.aerobicEfficiency' })).toBeTruthy();
});

it('scales one vertex per point, lower ratio higher on the canvas', () => {
  const vertices = efficiencySeriesVertices([point(0.64), point(0.62), point(0.59)], 100, 40);

  expect(vertices).toHaveLength(3);
  expect(vertices[0].x).toBeLessThan(vertices[2].x);
  expect(vertices[2].y).toBeLessThan(vertices[0].y);
});

it('centres a flat series instead of dividing by a zero range', () => {
  const vertices = efficiencySeriesVertices([point(0.6), point(0.6)], 100, 40);

  expect(vertices.every((v) => Number.isFinite(v.y))).toBe(true);
  expect(vertices[0].y).toBe(vertices[1].y);
});

it('rounds a rise in heart rate with its sign kept', async () => {
  const { getByTestId } = await render(
    <SectionEfficiencyCard trend={trend({ hrChangeBpm: 4.4, direction: 1 })} isDark={false} />
  );

  expect(getByTestId('section-efficiency-detail').props.children).toContain('+4');
});

it('renders nothing when the section has no efficiency series', async () => {
  const { queryByTestId } = await render(<SectionEfficiencyCard trend={null} isDark={false} />);

  expect(queryByTestId('section-efficiency-card')).toBeNull();
});

it('places the efforts by date, so a month-long gap is wider than a day', () => {
  const vertices = efficiencySeriesVertices(
    [point(0.64, 0), point(0.62, DAY), point(0.59, 31 * DAY)],
    100,
    40
  );

  const firstGap = vertices[1].x - vertices[0].x;
  const secondGap = vertices[2].x - vertices[1].x;
  expect(secondGap).toBeCloseTo(firstGap * 30);
});

it('spreads efforts that share one date evenly rather than stacking them', () => {
  const vertices = efficiencySeriesVertices([point(0.64, DAY), point(0.62, DAY)], 100, 40);

  expect(vertices[0].x).toBeLessThan(vertices[1].x);
});

it('draws the plot across the width the card gives it, not a fixed width', async () => {
  // A 412 dp window less the card's margins and padding.
  const contentWidth = 348;
  const tree = await render(<SectionEfficiencyCard trend={trend()} isDark={false} />);

  await layoutViews(tree, contentWidth, 56);

  const canvas = tree.UNSAFE_getByType(Canvas);
  expect(canvas.props.style).toEqual(expect.objectContaining({ width: contentWidth }));
});

describe.each([false, true])('an improving trend, dark %s', (isDark) => {
  async function drawn() {
    const tree = await render(
      <SectionEfficiencyCard trend={trend({ direction: 0 })} isDark={isDark} />
    );
    await layoutViews(tree, 348, 56);
    return tree;
  }

  it('draws the series in the single-series colour, never the verdict colour', async () => {
    const tree = await drawn();

    const marks = [...tree.UNSAFE_queryAllByType(Path), ...tree.UNSAFE_getAllByType(Circle)];
    const series = isDark ? darkColors.chartSeries : colors.chartSeries;
    expect(marks.map((mark) => mark.props.color)).toEqual(marks.map(() => series));
    expect(series).not.toBe(verdictColor('positive', isDark));
  });

  it('states the verdict in words on a badge', async () => {
    const tree = await drawn();

    expect(tree.getByTestId('section-efficiency-verdict')).toHaveTextContent(
      'sections.efficiencyVerdictImproving'
    );
  });
});

it.each([
  [1, 'sections.efficiencyVerdictFlat'],
  [2, 'sections.efficiencyVerdictWorsening'],
])('states direction %s on the badge as %s', async (direction, word) => {
  const { getByTestId } = await render(
    <SectionEfficiencyCard trend={trend({ direction })} isDark={false} />
  );

  expect(getByTestId('section-efficiency-verdict')).toHaveTextContent(word);
});

it('prints the lowest and highest ratio and says a lower ratio is drawn higher', async () => {
  const { getByTestId } = await render(
    <SectionEfficiencyCard
      trend={trend({ points: [point(141.4, DAY), point(150.6, 2 * DAY), point(138.2, 3 * DAY)] })}
      isDark={false}
    />
  );

  const range = getByTestId('section-efficiency-range');
  expect(range).toHaveTextContent(/138/);
  expect(range).toHaveTextContent(/151/);
  expect(getByTestId('section-efficiency-axis')).toHaveTextContent(
    'sections.aerobicEfficiencyInverted'
  );
});

it('speaks the effort count and the range on the plot', async () => {
  const { getByTestId } = await render(
    <SectionEfficiencyCard
      trend={trend({ points: [point(141.4, DAY), point(150.6, 2 * DAY), point(138.2, 3 * DAY)] })}
      isDark={false}
    />
  );

  const label = getByTestId('section-efficiency-chart').props.accessibilityLabel as string;
  expect(label).toContain('3');
  expect(label).toContain('138');
  expect(label).toContain('151');
});
