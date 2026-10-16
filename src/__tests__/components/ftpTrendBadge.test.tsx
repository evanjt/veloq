/**
 * Scenario: the eFTP change badge printed its text in green whatever the
 * direction, so a fall read as green on a red tint, and a zero change counted
 * as a rise.
 *
 * Expected behaviour: the text takes the verdict colour of the direction, and a
 * zero change is neutral with no arrow.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type TextStyle } from 'react-native';

import { initialiseI18n } from '@/i18n';
import { verdictColor } from '@/theme/colors';
import { FTPTrendChart } from '@/features/stats/components/FTPTrendChart';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@shopify/react-native-skia', () => ({
  Circle: () => null,
  LinearGradient: () => null,
  vec: () => ({}),
}));
jest.mock('@/shared/charts', () => ({
  ...jest.requireActual('@/shared/charts/chartSummary'),
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

function badgeColor(node: { props: { style?: unknown } }) {
  return StyleSheet.flatten(node.props.style as StyleProp<TextStyle>).color;
}

describe('the eFTP change badge', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  it('colours a fall as negative', async () => {
    const { getByText } = await render(
      <FTPTrendChart data={series} change={-12} changePercent={-4.6} />
    );
    expect(badgeColor(getByText('▼ 12 W'))).toBe(verdictColor('negative', false));
  });

  it('colours a rise as positive', async () => {
    const { getByText } = await render(
      <FTPTrendChart data={series} change={12} changePercent={4.8} />
    );
    expect(badgeColor(getByText('▲ 12 W'))).toBe(verdictColor('positive', false));
  });

  it('shows a flat series as neutral with no arrow', async () => {
    const { getByText } = await render(
      <FTPTrendChart data={series} change={0} changePercent={0} />
    );
    expect(badgeColor(getByText('0 W'))).toBe(verdictColor('neutral', false));
  });

  it('names the change for a screen reader with its judgement, not the triangle', async () => {
    const rise = await render(<FTPTrendChart data={series} change={12} changePercent={4.8} />);
    expect(rise.getByText('▲ 12 W').props.accessibilityLabel).toBe('improved, 12 W');
    await rise.unmount();

    const fall = await render(<FTPTrendChart data={series} change={-12} changePercent={-4.6} />);
    expect(fall.getByText('▼ 12 W').props.accessibilityLabel).toBe('declined, 12 W');
    await fall.unmount();

    const flat = await render(<FTPTrendChart data={series} change={0} changePercent={0} />);
    expect(flat.getByText('0 W').props.accessibilityLabel).toBe('no change, 0 W');
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
