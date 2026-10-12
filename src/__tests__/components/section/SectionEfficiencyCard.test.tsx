/**
 * Scenario: the aerobic efficiency series the performance read carries for a
 * section or a route.
 * Expected behaviour: the card plots the series it was given and stays off
 * screen when the read has none.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import {
  SectionEfficiencyCard,
  efficiencySeriesVertices,
} from '@/features/routes/components/section/SectionEfficiencyCard';
import type { EfficiencyTrend } from 'veloqrs';

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

function point(ratio: number) {
  return {
    date: 1,
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
    points: [point(0.64), point(0.62), point(0.59)],
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
