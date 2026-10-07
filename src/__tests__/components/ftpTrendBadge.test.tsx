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

import { initializeI18n } from '@/i18n';
import { verdictColor } from '@/theme/colors';
import { FTPTrendChart } from '@/features/stats/components/FTPTrendChart';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@shopify/react-native-skia', () => ({
  Circle: () => null,
  LinearGradient: () => null,
  vec: () => ({}),
}));
jest.mock('@/shared/charts', () => ({
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
    await initializeI18n('en-AU');
  });

  it('colours a fall as negative', () => {
    const { getByText } = render(<FTPTrendChart data={series} change={-12} changePercent={-4.6} />);
    expect(badgeColor(getByText('▼ 12W'))).toBe(verdictColor('negative', false));
  });

  it('colours a rise as positive', () => {
    const { getByText } = render(<FTPTrendChart data={series} change={12} changePercent={4.8} />);
    expect(badgeColor(getByText('▲ 12W'))).toBe(verdictColor('positive', false));
  });

  it('shows a flat series as neutral with no arrow', () => {
    const { getByText } = render(<FTPTrendChart data={series} change={0} changePercent={0} />);
    expect(badgeColor(getByText('0W'))).toBe(verdictColor('neutral', false));
  });
});
