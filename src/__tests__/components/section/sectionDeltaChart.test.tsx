/**
 * Scenario: the delta plot draws the engine's per-lap delta curves against the
 * section's reference, and the plot switch offers it only where there are curves.
 * Expected behaviour: the selected attempt (else the newest) is drawn in full and
 * the rest faint, a NaN run is a gap, the whole-section figure needs an end delta,
 * and attempts without a curve are counted.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Path } from '@shopify/react-native-skia';

import { SectionDeltaChart } from '@/features/routes/components/section/SectionDeltaChart';
import { PerformanceChartPanel } from '@/features/routes/components/section/PerformanceChartPanel';
import type { PerformanceDataPoint } from '@/types';
import type {
  FfiDirectionDeltas,
  FfiLapDelta,
  FfiLapDeltaMissing,
  FfiSectionLapCurves,
} from 'veloqrs';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());

const GRID_STEP_M = 50;
const SECTION_LENGTH_M = 400;
const DAY_SECS = 86_400;

function lap(id: string, day: number, deltaSecs: number[], extra: Partial<FfiLapDelta> = {}) {
  return {
    activityId: id,
    startIndex: 0,
    activityDate: 1_780_000_000 + day * DAY_SECS,
    deltaSecs,
    splitDeltaSecs: [],
    endDeltaSecs: deltaSecs[deltaSecs.length - 1],
    ...extra,
  } as FfiLapDelta;
}

function direction(
  laps: FfiLapDelta[],
  extra: Partial<FfiDirectionDeltas> = {}
): FfiDirectionDeltas {
  return {
    referenceActivityId: 'ref',
    referenceSource: 0,
    laps,
    missing: [],
    ...extra,
  } as FfiDirectionDeltas;
}

function missing(id: string): FfiLapDeltaMissing {
  return { activityId: id, startIndex: 0, activityDate: 1_780_000_000, reason: 0 };
}

const LEVEL = [0, 0, 0, 0, 0, 0, 0, 0, 0];
const LAPS = [
  lap('ref', 0, LEVEL),
  lap('older', 1, [0, 1, 2, 3, 4, 5, 6, 7, 8]),
  lap('newest', 2, [0, -1, -2, -3, -4, -5, -6, -7, -8]),
];

function chart(props: Partial<React.ComponentProps<typeof SectionDeltaChart>> = {}) {
  return (
    <SectionDeltaChart
      deltas={direction(LAPS)}
      gridStepM={GRID_STEP_M}
      sectionLengthM={SECTION_LENGTH_M}
      isDark={false}
      {...props}
    />
  );
}

/** The Path props drawn on each render, so a test reads what was placed. */
function capturePaths() {
  const drawn: Record<string, unknown>[] = [];
  const path = Path as unknown as {
    render: (props: Record<string, unknown>, ref: unknown) => React.ReactNode;
  };
  const original = path.render;
  jest.spyOn(path, 'render').mockImplementation((props, ref) => {
    drawn.push(props);
    return original(props, ref);
  });
  return drawn;
}

const full = (drawn: Record<string, unknown>[]) => drawn.filter((p) => p.opacity === undefined);

describe('SectionDeltaChart', () => {
  afterEach(() => jest.restoreAllMocks());

  it('draws the newest attempt in full and the others faint when none is selected', () => {
    const drawn = capturePaths();
    render(chart());

    const emphasised = full(drawn);
    expect(emphasised).toHaveLength(1);
    // The newest attempt is ahead of the reference throughout, so it runs below the zero line.
    const ys = String(emphasised[0]!.path)
      .match(/ (-?[\d.]+)/g)!
      .map((y) => Number(y));
    expect(Math.min(...ys)).toBeGreaterThan(0);
    expect(drawn.length).toBe(LAPS.length);
  });

  it('draws the selected attempt in full instead of the newest', () => {
    const drawn = capturePaths();
    const withNewest = render(chart());
    const newestPath = String(full(drawn)[0]!.path);
    withNewest.unmount();
    drawn.length = 0;

    render(chart({ highlightedActivityId: 'older' }));

    expect(full(drawn)).toHaveLength(1);
    expect(String(full(drawn)[0]!.path)).not.toBe(newestPath);
  });

  it('leaves a gap at a NaN run and does not draw a zero there', () => {
    const drawn = capturePaths();
    const partial = lap('partial', 3, [NaN, NaN, 0, 4, NaN, NaN, 5, 6, 7]);
    render(chart({ deltas: direction([partial]) }));

    const path = String(full(drawn)[0]!.path);
    expect(path.match(/M/g)).toHaveLength(2);
    expect(path).not.toMatch(/NaN/);
  });

  it('shows the whole-section figure only where the engine gave an end delta', () => {
    const withEnd = render(chart({ highlightedActivityId: 'older' }));
    expect(withEnd.getByTestId('section-delta-end').props.children).toContain('"time":"8s"');
    withEnd.unmount();

    const partial = lap('partial', 3, [NaN, 0, 2, 3]);
    delete (partial as { endDeltaSecs?: number }).endDeltaSecs;
    const withoutEnd = render(chart({ deltas: direction([partial]) }));
    expect(withoutEnd.queryByTestId('section-delta-end')).toBeNull();
  });

  it('counts the attempts that have no curve', () => {
    const tree = render(
      chart({ deltas: direction(LAPS, { missing: [missing('x'), missing('y')] }) })
    );

    expect(tree.getByTestId('section-delta-missing').props.children).toContain('"attempts":2');
  });

  it('shows no missing count when every attempt is drawn', () => {
    const tree = render(chart());

    expect(tree.queryByTestId('section-delta-missing')).toBeNull();
  });

  it('names the record as the reference, with its date', () => {
    const record = render(chart());
    expect(record.getByTestId('section-delta-caption').props.children).toContain(
      'sections.deltaVsRecord'
    );
    record.unmount();

    const set = render(
      chart({
        deltas: direction(LAPS, { referenceSource: 1 as FfiDirectionDeltas['referenceSource'] }),
      })
    );
    expect(set.getByTestId('section-delta-caption').props.children).toContain(
      'sections.deltaVsReference'
    );
  });
});

const CHART_DATA = Array.from({ length: 4 }, (_, i) => ({
  id: `lap-${i}`,
  activityId: `act-${i}`,
  date: new Date(2026, 5, i + 1),
  speed: 5 + i * 0.1,
  sectionTime: 305 + i * 10,
  sectionDistance: 3000,
  direction: 'forward',
  x: i / 3,
})) as unknown as (PerformanceDataPoint & { x: number })[];

function panel(curves: FfiSectionLapCurves | undefined) {
  return (
    <PerformanceChartPanel
      chartData={CHART_DATA}
      activityType="Ride"
      isDark={false}
      bestForwardRecord={null}
      bestReverseRecord={null}
      bestForwardIsRecord={false}
      bestReverseIsRecord={false}
      forwardStats={null}
      reverseStats={null}
      trendCurves={{}}
      curves={curves}
    />
  );
}

describe('PerformanceChartPanel delta plot', () => {
  it('offers delta when the direction has curves and draws it when chosen', () => {
    const tree = render(
      panel({
        gridStepM: GRID_STEP_M,
        splitStepM: 100,
        sectionLengthM: SECTION_LENGTH_M,
        forward: direction(LAPS),
      })
    );

    fireEvent.press(tree.getByTestId('chart-plot-delta'));
    expect(tree.getByTestId('section-delta-chart')).toBeTruthy();
    expect(tree.getByTestId('chart-plot-delta').props.accessibilityState.selected).toBe(true);
  });

  it('offers no delta option when curves is absent', () => {
    const tree = render(panel(undefined));

    expect(tree.queryByTestId('chart-plot-delta')).toBeNull();
  });

  it('offers no delta option for a direction without curves', () => {
    const tree = render(
      panel({
        gridStepM: GRID_STEP_M,
        splitStepM: 100,
        sectionLengthM: SECTION_LENGTH_M,
        reverse: direction(LAPS),
      })
    );

    expect(tree.queryByTestId('chart-plot-delta')).toBeNull();
  });
});
