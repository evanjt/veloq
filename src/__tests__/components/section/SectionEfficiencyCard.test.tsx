/**
 * Scenario: the aerobic efficiency series the performance read carries for a
 * section or a route.
 * Expected behaviour: the card plots the series it was given and stays off
 * screen when the read has none.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { Canvas, Circle, Path } from '@shopify/react-native-skia';
import { SectionEfficiencyCard } from '@/features/routes/components/section/SectionEfficiencyCard';
import { SPARKLINE_RANGE_WIDTH } from '@/shared/charts';
import type { EfficiencyTrend } from 'veloqrs';
import { colors, darkColors, spacing, verdictColor } from '@/theme';
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

it('hands the sparkline every effort at its date, a lower ratio drawn higher', async () => {
  const { UNSAFE_getByProps } = await render(
    <SectionEfficiencyCard
      trend={trend({ points: [point(0.64, 0), point(0.62, DAY), point(0.59, 31 * DAY)] })}
      isDark={false}
    />
  );

  const sparkline = UNSAFE_getByProps({
    testID: 'section-efficiency-chart',
    showRange: true,
  }).props;
  expect(sparkline.points.map((p: { date: number }) => p.date)).toEqual([0, DAY, 31 * DAY]);
  expect(sparkline.points.map((p: { value: number }) => p.value)).toEqual([0.64, 0.62, 0.59]);
  expect(sparkline.invert).toBe(true);
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

it('draws the plot across the width the card gives it, not a fixed width', async () => {
  // A 412 dp window less the card's margins and padding.
  const contentWidth = 348;
  const tree = await render(<SectionEfficiencyCard trend={trend()} isDark={false} />);

  await layoutViews(tree, contentWidth, 56);

  const canvas = tree.UNSAFE_getByType(Canvas);
  expect(canvas.props.style).toEqual(
    expect.objectContaining({ width: contentWidth - SPARKLINE_RANGE_WIDTH - spacing.xs })
  );
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

    // The last effort's dot sits in a ring of the surface it is drawn on.
    const marks = [...tree.UNSAFE_queryAllByType(Path), ...tree.UNSAFE_getAllByType(Circle)];
    const series = isDark ? darkColors.chartSeries : colors.chartSeries;
    const surface = colors.surface;
    const colours = new Set(marks.map((mark) => mark.props.color));
    expect(colours).toEqual(new Set([series, surface]));
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

  const range = getByTestId('section-efficiency-chart-range', { includeHiddenElements: true });
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
