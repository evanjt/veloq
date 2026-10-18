/**
 * Scenario: the section scatter chart built its two trend lines and two
 * confidence bands inside the ChartCanvas render prop, so every scrub tick and
 * every parent render re-parsed four SVG path strings.
 *
 * Expected behaviour: the paths are pixels, so they are rebuilt only when the
 * box or the domain moves.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Circle, Skia } from '@shopify/react-native-skia';

import { SectionScatterChart } from '@/features/routes/components/section/SectionScatterChart';
import type { PerformanceDataPoint } from '@/types';
import { colors, directionPair } from '@/theme';
import { layoutViews } from '../__shared__/layoutViews';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const CHART_DATA = Array.from({ length: 12 }, (_, i) => ({
  id: `lap-${i}`,
  activityId: `act-${i}`,
  date: new Date(2026, 5, i + 1),
  speed: 5 + (i % 4) * 0.25,
  sectionTime: 600 - i * 5,
  sectionDistance: 3000,
  direction: i % 3 === 0 ? 'reverse' : 'forward',
  x: i / 11,
})) as unknown as (PerformanceDataPoint & { x: number })[];

const CURVE = Array.from({ length: 20 }, (_, i) => ({
  time: new Date(2026, 5, 1).getTime() / 1000 + i * 86_400 * 0.55,
  value: 5.4 + i * 0.01,
  upper: 5.8 + i * 0.01,
  lower: 5 + i * 0.01,
}));

const TIME_CURVE = CURVE.map((p, i) => ({
  ...p,
  value: 560 - i,
  upper: 580 - i,
  lower: 540 - i,
}));

const TREND_CURVES = {
  forwardSpeed: CURVE,
  reverseSpeed: CURVE,
  forwardTime: TIME_CURVE,
  reverseTime: TIME_CURVE,
};

function chart(props: Partial<React.ComponentProps<typeof SectionScatterChart>> = {}) {
  return (
    <SectionScatterChart
      chartData={CHART_DATA}
      activityType="Ride"
      isDark={false}
      bestForwardRecord={null}
      bestReverseRecord={null}
      bestForwardIsRecord={false}
      bestReverseIsRecord={false}
      forwardStats={{ avgTime: 560, lastActivity: null, count: 3 }}
      reverseStats={{ avgTime: 560, lastActivity: null, count: 3 }}
      trendCurves={TREND_CURVES}
      {...props}
    />
  );
}

describe('section scatter trend paths', () => {
  afterEach(() => jest.restoreAllMocks());

  it('shows only the selected direction and opens on the linked activity direction', async () => {
    const rendered: Record<string, unknown>[] = [];
    const circleComponent = Circle as unknown as {
      render: (props: Record<string, unknown>, ref: unknown) => React.ReactNode;
    };
    const originalRender = circleComponent.render;
    jest.spyOn(circleComponent, 'render').mockImplementation((props, ref) => {
      rendered.push(props);
      return originalRender(props, ref);
    });
    const tree = await render(chart({ highlightedActivityId: 'act-0' }));
    await layoutViews(tree, 400, 300);
    const forward = tree.getByTestId('section-chart-direction-forward');
    const reverse = tree.getByTestId('section-chart-direction-reverse');

    expect(reverse.props.accessibilityState.selected).toBe(true);
    expect(rendered.filter((dot) => dot.color === directionPair.light.reverse)).toHaveLength(3);

    rendered.length = 0;
    await fireEvent.press(forward);

    expect(forward.props.accessibilityState.selected).toBe(true);
    expect(rendered.filter((dot) => dot.color === directionPair.light.reverse)).toHaveLength(0);
  });

  it('omits the direction switch for a single direction', async () => {
    const tree = await render(
      chart({ chartData: CHART_DATA.filter((point) => point.direction !== 'reverse') })
    );
    expect(tree.queryByTestId('section-chart-direction-forward')).toBeNull();
    expect(tree.queryByTestId('section-chart-direction-reverse')).toBeNull();
  });

  // Built from the box the chart is given rather than from the canvas's own
  // measurement, so they survive a re-render that changes nothing.
  it('does not rebuild the trend paths on a render that changes nothing', async () => {
    const svg = jest.spyOn(Skia.Path, 'MakeFromSVGString');
    const tree = await render(chart());
    await layoutViews(tree, 400, 300);
    const atRest = svg.mock.calls.length;
    expect(atRest).toBeGreaterThan(0);

    await tree.rerender(chart());

    expect(svg.mock.calls.length).toBe(atRest);
  });

  it('rebuilds them when the drawn axis changes', async () => {
    const svg = jest.spyOn(Skia.Path, 'MakeFromSVGString');
    const tree = await render(chart());
    await layoutViews(tree, 400, 300);
    const atRest = svg.mock.calls.length;

    await tree.rerender(chart({ useTimeAxis: true }));

    expect(svg.mock.calls.length).toBeGreaterThan(atRest);
  });

  it.each([false, true])(
    'rings the point the engine flags, not the fastest, with the time axis %s',
    async (useTimeAxis) => {
      const rendered: Record<string, unknown>[] = [];
      const circleComponent = Circle as unknown as {
        render: (props: Record<string, unknown>, ref: unknown) => React.ReactNode;
      };
      const originalRender = circleComponent.render;
      jest.spyOn(circleComponent, 'render').mockImplementation((props, ref) => {
        rendered.push(props);
        return originalRender(props, ref);
      });
      const points = [
        {
          id: 'excluded',
          activityId: 'excluded',
          date: new Date(2026, 5, 1),
          speed: 8,
          sectionTime: 100,
          isExcluded: true,
          direction: 'same',
          x: 0,
        },
        {
          id: 'best',
          activityId: 'best',
          date: new Date(2026, 5, 2),
          speed: 6,
          sectionTime: 200,
          isBest: true,
          direction: 'same',
          x: 0.5,
        },
        {
          id: 'slower',
          activityId: 'slower',
          date: new Date(2026, 5, 3),
          speed: 9,
          sectionTime: 150,
          direction: 'same',
          x: 1,
        },
      ] as unknown as (PerformanceDataPoint & { x: number })[];
      const tree = await render(chart({ chartData: points, useTimeAxis }));
      await layoutViews(tree, 400, 300);
      // The points sit at x 0, 0.5 and 1, so the best one is drawn midway
      // between the first and the last, whatever styling the ring gives it.
      const xs = [...new Set(rendered.map((circle) => circle.cx as number))].sort((a, b) => a - b);
      expect(xs).toHaveLength(3);
      const ring = rendered.find((circle) => circle.color === colors.achievement);
      expect(ring).toBeDefined();
      expect(ring?.cx).toBeCloseTo((xs[0] + xs[2]) / 2);
    }
  );
});
