/**
 * Scenario: the aerobic efficiency series the engine keeps for a section.
 * Expected behaviour: the card plots the series it was given and stays off
 * screen when the section has none.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import {
  SectionEfficiencyCard,
  efficiencySeriesVertices,
} from '@/features/routes/components/section/SectionEfficiencyCard';
import type { EfficiencyTrend } from 'veloqrs';

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) =>
      params ? `${key}:${Object.values(params).join(',')}` : key,
  }),
}));

const mockEngineTrend = jest.fn<EfficiencyTrend | null, [string]>();

jest.mock('@/features/routes/hooks/useSectionEfficiencyTrend', () => ({
  useSectionEfficiencyTrend: (sectionId: string) => mockEngineTrend(sectionId),
}));

function point(ratio: number) {
  return {
    date: BigInt(1),
    paceSecsPerKm: 240,
    avgHr: 150,
    hrPaceRatio: ratio,
  };
}

function trend(overrides: Partial<EfficiencyTrend> = {}): EfficiencyTrend {
  return {
    sectionId: 'sec-1',
    sectionName: 'Church Hill',
    points: [point(0.64), point(0.62), point(0.59)],
    trendSlope: -0.0004,
    isImproving: true,
    hrChangeBpm: -6.2,
    effortCount: 3,
    ...overrides,
  } as EfficiencyTrend;
}

beforeEach(() => jest.clearAllMocks());

it('renders the effort count and the HR change the engine measured', () => {
  mockEngineTrend.mockReturnValue(trend());

  const { getByTestId } = render(<SectionEfficiencyCard sectionId="sec-1" isDark={false} />);

  expect(getByTestId('section-efficiency-card')).toBeTruthy();
  expect(getByTestId('section-efficiency-detail').props.children).toContain('3');
  expect(getByTestId('section-efficiency-detail').props.children).toContain('-6');
});

it('renders the chart for a section that has a series', () => {
  mockEngineTrend.mockReturnValue(trend());

  const { getByTestId } = render(<SectionEfficiencyCard sectionId="sec-1" isDark={false} />);

  expect(getByTestId('section-efficiency-chart')).toBeTruthy();
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

it('rounds a rise in heart rate with its sign kept', () => {
  mockEngineTrend.mockReturnValue(trend({ hrChangeBpm: 4.4, isImproving: false }));

  const { getByTestId } = render(<SectionEfficiencyCard sectionId="sec-1" isDark={false} />);

  expect(getByTestId('section-efficiency-detail').props.children).toContain('+4');
});

it('renders nothing when the section has no efficiency series', () => {
  mockEngineTrend.mockReturnValue(null);

  const { queryByTestId } = render(<SectionEfficiencyCard sectionId="sec-1" isDark={false} />);

  expect(queryByTestId('section-efficiency-card')).toBeNull();
});
