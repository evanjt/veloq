/**
 * Scenario: a run section's performance plots, fed pace text unlike what each speed formats to.
 * Expected behaviour: the scatter's axis marks and the histogram's bin edges print the engine's
 * text for their own values, and a pace the engine did not write prints the absent mark rather
 * than one worked out from the speed.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { AttemptHistogramChart } from '@/features/routes/components/section/AttemptHistogramChart';
import { SectionScatterChart } from '@/features/routes/components/section/SectionScatterChart';
import type { PerformanceDataPoint } from '@/types';
import type { FfiAttemptHistogram, FfiScatterFocus } from 'veloqrs';
import { layoutViews } from '../../__shared__/layoutViews';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());

let mockIsMetric = true;
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useMetricSystem: () => mockIsMetric,
  useTheme: () => ({ isDark: false }),
}));

beforeAll(() => initialiseI18n('en-AU'));
afterEach(() => {
  mockIsMetric = true;
});

const text = (metricText: string, imperialText: string) => ({ metricText, imperialText });

const POINTS = [
  { id: 'lap-1', activityId: 'a', speed: 3, speedPace: text('7:11', '11:34') },
  { id: 'lap-2', activityId: 'b', speed: 4, speedPace: text('4:11', '6:44') },
].map((p, i) => ({
  direction: 'same',
  activityName: p.activityId,
  date: new Date(2026, 5, i + 1),
  sectionTime: 600,
  x: 0,
  ...p,
})) as unknown as (PerformanceDataPoint & { x: number })[];

const FOCUS: FfiScatterFocus = {
  forward: {
    low: 3,
    high: 4,
    slowCount: 0,
    fastCount: 0,
    lowPace: text('7:11', '11:34'),
    midPace: text('5:44', '9:14'),
    highPace: text('4:11', '6:44'),
  },
};

async function scatter(focus: FfiScatterFocus) {
  const tree = await render(
    <SectionScatterChart
      chartData={POINTS}
      activityType="Run"
      isDark={false}
      bestForwardRecord={null}
      bestReverseRecord={null}
      bestForwardIsRecord={false}
      bestReverseIsRecord={false}
      forwardStats={null}
      reverseStats={null}
      trendCurves={{}}
      scatterFocus={focus}
    />
  );
  await layoutViews(tree, 400, 220);
  return tree;
}

const marks = (tree: Awaited<ReturnType<typeof scatter>>) =>
  [0, 1, 2].map((i) => tree.getByTestId(`section-scatter-y-axis-${i}`).props.children);

describe('the scatter axis marks', () => {
  it('print the engine text for the top, middle and bottom of the range', async () => {
    expect(marks(await scatter(FOCUS))).toEqual(['4:11 /km', '5:44 /km', '7:11 /km']);
  });

  it('print the text of the unit system shown', async () => {
    mockIsMetric = false;
    expect(marks(await scatter(FOCUS))).toEqual(['6:44 /mi', '9:14 /mi', '11:34 /mi']);
  });

  it('print the absent mark for a mark the engine wrote no pace for', async () => {
    const { midPace: _mid, ...withoutMid } = FOCUS.forward!;
    expect(marks(await scatter({ forward: withoutMid }))).toEqual([
      '4:11 /km',
      '--:--',
      '7:11 /km',
    ]);
  });
});

const HISTOGRAM: FfiAttemptHistogram = {
  startSecs: 300,
  binWidthSecs: 30,
  counts: [1, 4, 6],
  edgeSpeeds: [3, 3.2, 3.4, 3.6],
  edgePace: [text('5:33', '8:57'), text('5:12', '8:22'), undefined, text('4:38', '7:28')],
  binned: 11,
  unbinnedOutsideBand: 0,
};

describe('the histogram bin edges', () => {
  it('print the engine text of their speed, the absent mark where it wrote none', async () => {
    const tree = await render(
      <AttemptHistogramChart histogram={HISTOGRAM} activityType="Run" isDark={false} />
    );
    await layoutViews(tree, 400, 300);

    expect(tree.getAllByText('5:33 /km').length).toBeGreaterThan(0);
    expect(tree.getAllByText('4:38 /km').length).toBeGreaterThan(0);
    expect(tree.queryByText(/5:13|5:14/)).toBeNull();
  });

  it('print speeds for a speed sport', async () => {
    const { edgePace: _pace, ...speedsOnly } = HISTOGRAM;
    const tree = await render(
      <AttemptHistogramChart histogram={speedsOnly} activityType="Ride" isDark={false} />
    );
    await layoutViews(tree, 400, 300);

    expect(tree.queryByText(/\/km/)).toBeNull();
  });
});
