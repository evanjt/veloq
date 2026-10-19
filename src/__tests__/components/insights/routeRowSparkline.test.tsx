/**
 * Scenario: a route insight row draws the route's recent efforts as a small
 * trend beside its best time, and the trend glyph says whether it got faster.
 *
 * Expected behaviour: the line is the kit sparkline, fastest at the top as the
 * section timelines draw times, in the series colour of what it measures
 * whatever the verdict, with no area under it, and the row prints and speaks
 * the range the line spans. The verdict colour stays on the glyph.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react-native';
import { Circle, LinearGradient, Path, Skia } from '@shopify/react-native-skia';

import { changeLanguage, initialiseI18n } from '@/i18n';
import { RouteInsightContent } from '@/features/insights/components/content/RouteInsightContent';
import { rowTrendColor } from '@/features/insights/lib/rowTrend';
import { colors, darkColors } from '@/theme';
import type { Insight } from '@/types';

let mockDark = false;
jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: mockDark }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

beforeAll(() => initialiseI18n('en-GB'));
beforeEach(() => {
  changeLanguage('en-GB');
  jest
    .spyOn(Skia.Path, 'MakeFromSVGString')
    .mockReturnValue({} as ReturnType<typeof Skia.Path.MakeFromSVGString>);
});

function routeInsight(trend: number, efforts: number[]): Insight {
  return {
    id: 'route-orchard',
    category: 'route',
    priority: 1,
    title: 'Routes',
    icon: 'map-marker-path',
    iconTone: 'neutral',
    timestamp: 0,
    isNew: false,
    supportingData: {
      routes: [
        {
          rowKey: 'orchard:Run',
          routeId: 'orchard',
          routeName: 'Orchard loop',
          sportType: 'Run',
          isRecentRecord: false,
          trend,
          bestTime: 1490,
          daysSinceLast: 2,
          attemptCount: 5,
          recentEfforts: efforts.map((value, i) => ({
            date: 1_772_323_200 + i * 86_400,
            value,
          })),
          navigationTarget: '/route/orchard',
        },
      ],
    },
  } as unknown as Insight;
}

describe('a route insight row', () => {
  afterEach(() => {
    mockDark = false;
    jest.restoreAllMocks();
  });

  it.each([
    ['light', false],
    ['dark', true],
  ])('strokes a faster route in the series colour in %s mode', (_mode, dark) => {
    mockDark = dark;
    render(<RouteInsightContent insight={routeInsight(1, [1620, 1580, 1545, 1490])} />);
    const lines = screen.UNSAFE_getAllByType(Path).filter((p) => p.props.style === 'stroke');
    expect(lines).toHaveLength(1);
    expect(lines[0].props.color).toBe(dark ? darkColors.chartSeries : colors.chartSeries);
    expect(lines[0].props.color).not.toBe(rowTrendColor(1, dark));
  });

  it('strokes a slower route in the same series colour', () => {
    render(<RouteInsightContent insight={routeInsight(-1, [1490, 1520, 1580])} />);
    const lines = screen.UNSAFE_getAllByType(Path).filter((p) => p.props.style === 'stroke');
    expect(lines[0].props.color).toBe(colors.chartSeries);
  });

  it('draws no area under the line', () => {
    render(<RouteInsightContent insight={routeInsight(1, [1620, 1580, 1545, 1490])} />);
    expect(screen.UNSAFE_queryAllByType(LinearGradient)).toHaveLength(0);
    expect(screen.UNSAFE_getAllByType(Path).every((p) => p.props.style === 'stroke')).toBe(true);
  });

  // The latest effort carries the line's one dot, so its height says which way up the line is.
  function latestEffortY(): number {
    const dots = screen.UNSAFE_getAllByType(Circle);
    return dots[dots.length - 1].props.cy;
  }

  it('draws a faster route rising, its latest and fastest effort at the top', () => {
    render(<RouteInsightContent insight={routeInsight(1, [1620, 1580, 1545, 1490])} />);
    expect(latestEffortY()).toBeLessThan(28 / 2);
  });

  it('draws a slower route falling, its latest and slowest effort at the foot', () => {
    render(<RouteInsightContent insight={routeInsight(-1, [1490, 1520, 1580])} />);
    expect(latestEffortY()).toBeGreaterThan(28 / 2);
  });

  it('prints the fastest time at the top of the range and the slowest below', () => {
    render(<RouteInsightContent insight={routeInsight(1, [1620, 1580, 1545, 1490])} />);
    // The printed range is hidden from a screen reader, which hears it in the row's label.
    const hidden = { includeHiddenElements: true };
    const range = screen.getByTestId('route-insight-sparkline-orchard:Run-range', hidden);
    expect(
      within(range)
        .getAllByText(/^\d+:\d\d$/, hidden)
        .map((node) => node.props.children)
    ).toEqual(['24:50', '27:00']);
  });

  it('speaks the range the line spans', () => {
    render(<RouteInsightContent insight={routeInsight(1, [1620, 1580, 1545, 1490])} />);
    expect(screen.getByRole('button').props.accessibilityLabel).toContain('24:50-27:00');
  });

  it('draws no line and prints no range under three efforts', () => {
    render(<RouteInsightContent insight={routeInsight(1, [1580, 1490])} />);
    expect(screen.UNSAFE_queryAllByType(Path)).toHaveLength(0);
    expect(screen.UNSAFE_queryAllByType(Circle)).toHaveLength(0);
  });
});
