/**
 * Scenario: the section scatter chart built its two trend lines and two
 * confidence bands inside the ChartCanvas render prop, so every scrub tick and
 * every parent render re-parsed four SVG path strings.
 *
 * Expected behaviour: the paths are pixels, so they are rebuilt only when the
 * box or the domain moves.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { Skia } from '@shopify/react-native-skia';

import { SectionScatterChart } from '@/features/routes/components/section/SectionScatterChart';
import type { PerformanceDataPoint } from '@/types';

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

function chart(props: Partial<React.ComponentProps<typeof SectionScatterChart>> = {}) {
  return (
    <SectionScatterChart
      chartData={CHART_DATA}
      activityType="Ride"
      isDark={false}
      bestForwardRecord={null}
      bestReverseRecord={null}
      forwardStats={null}
      reverseStats={null}
      {...props}
    />
  );
}

describe('section scatter trend paths', () => {
  afterEach(() => jest.restoreAllMocks());

  // Built from the box the chart is given rather than from the canvas's own
  // measurement, so they exist before a layout pass and survive a re-render.
  it('does not rebuild the trend paths on a render that changes nothing', () => {
    const svg = jest.spyOn(Skia.Path, 'MakeFromSVGString');
    const tree = render(chart());
    const atRest = svg.mock.calls.length;
    expect(atRest).toBeGreaterThan(0);

    tree.rerender(chart());

    expect(svg.mock.calls.length).toBe(atRest);
  });

  it('rebuilds them when the drawn axis changes', () => {
    const svg = jest.spyOn(Skia.Path, 'MakeFromSVGString');
    const tree = render(chart());
    const atRest = svg.mock.calls.length;

    tree.rerender(chart({ useTimeAxis: true }));

    expect(svg.mock.calls.length).toBeGreaterThan(atRest);
  });
});
