/**
 * Scenario: the eFTP change badge printed its text in green whatever the
 * direction, so a fall read as green on a red tint, and a zero change counted
 * as a rise.
 *
 * Expected behaviour: the badge takes the tone of the direction's verdict, and
 * a zero change is neutral with no arrow.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { initialiseI18n } from '@/i18n';
import { badgePaint } from '@/shared/ui/Badge';
import { FTPTrendChart } from '@/features/stats/components/FTPTrendChart';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@shopify/react-native-skia', () => ({
  Circle: () => null,
  LinearGradient: () => null,
  vec: () => ({}),
}));
jest.mock('react-native-gesture-handler', () => ({
  ...jest.requireActual('react-native-gesture-handler'),
  GestureDetector: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('@/shared/charts', () => ({
  ...jest.requireActual('@/shared/charts/chartSummary'),
  ...jest.requireActual('@/shared/charts/axisLabels'),
  ...jest.requireActual('@/shared/charts/cartesian'),
  YAxisLabels: () => null,
  ChartCrosshair: () => null,
  ScrubDot: () => null,
  useChartGestures: () => ({
    gesture: {},
    crosshairStyle: {},
    syncBounds: () => undefined,
    syncXCoords: () => undefined,
    accessibilityProps: {},
    scrubIndex: -1,
    selectedPoint: null,
  }),
  ChartSurface: ({ children }: { children: React.ReactNode }) => children,
  ChartCanvas: () => null,
  CurveArea: () => null,
  CurveLine: () => null,
  useChartColors: () => ({}),
}));

const series = [
  { date: '2026-07-01', eftp: 262 },
  { date: '2026-09-30', eftp: 250 },
];

/** The fill of the closest view behind a text, which is the badge it sits on. */
function badgeFill(node: ReactTestInstance): string | undefined {
  for (let at: ReactTestInstance | null = node; at; at = at.parent) {
    const fill = StyleSheet.flatten(at.props.style ?? {}).backgroundColor;
    if (typeof fill === 'string') return fill;
  }
  return undefined;
}

describe('the eFTP change badge', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  it('colours a fall as negative', async () => {
    const { getByText } = await render(
      <FTPTrendChart data={series} change={-12} changePercent={-4.6} />
    );
    expect(badgeFill(getByText('▼ 12 W'))).toBe(badgePaint('negative', false).fill);
  });

  it('colours a rise as positive', async () => {
    const { getByText } = await render(
      <FTPTrendChart data={series} change={12} changePercent={4.8} />
    );
    expect(badgeFill(getByText('▲ 12 W'))).toBe(badgePaint('positive', false).fill);
  });

  it('shows a flat series as neutral with no arrow', async () => {
    const { getByText } = await render(
      <FTPTrendChart data={series} change={0} changePercent={0} />
    );
    expect(badgeFill(getByText('0 W'))).toBe(badgePaint('neutral', false).fill);
  });

  it('names the change for a screen reader with its judgement, not the triangle', async () => {
    const rise = await render(<FTPTrendChart data={series} change={12} changePercent={4.8} />);
    expect(rise.getByLabelText('improved, 12 W')).toBeTruthy();
    await rise.unmount();

    const fall = await render(<FTPTrendChart data={series} change={-12} changePercent={-4.6} />);
    expect(fall.getByLabelText('declined, 12 W')).toBeTruthy();
    await fall.unmount();

    const flat = await render(<FTPTrendChart data={series} change={0} changePercent={0} />);
    expect(flat.getByLabelText('no change, 0 W')).toBeTruthy();
  });
});

describe('the eFTP change caption', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  it('names the window the step was measured over, not the range the chart draws', async () => {
    const { getByText, queryByText } = await render(
      <FTPTrendChart data={series} change={5} changePercent={1.85} lookbackDays={30} />
    );
    expect(getByText('+1.9% from 30 days ago')).toBeTruthy();
    expect(queryByText(/3 months/)).toBeNull();
  });

  it('pluralises a one-day window', async () => {
    const { getByText } = await render(
      <FTPTrendChart data={series} change={-2} changePercent={-0.8} lookbackDays={1} />
    );
    expect(getByText('-0.8% from 1 day ago')).toBeTruthy();
  });

  it('states no window when the engine named none', async () => {
    const { queryByText } = await render(
      <FTPTrendChart data={series} change={0} changePercent={0} lookbackDays={0} />
    );
    expect(queryByText(/ago/)).toBeNull();
  });
});
