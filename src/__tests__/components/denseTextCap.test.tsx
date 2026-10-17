/**
 * Scenario: the app honours the system text size everywhere and caps it
 * nowhere, so a grid laid out in fixed columns overlaps at 200 per cent rather
 * than reflowing. WCAG 1.4.4 asks for 200 per cent without loss of function,
 * and a dense grid does not meet it today: it fails silently.
 *
 * Expected behaviour: the surfaces that cannot reflow state their limit
 * instead of pretending, and every surface that can take 200 per cent keeps
 * it. So the cap is on the named dense components and on nothing else.
 */

import { execFileSync } from 'node:child_process';

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { DENSE_TEXT_SCALE, DenseText } from '@/shared/ui/DenseText';
import { TextLink } from '@/shared/ui/TextLink';
import { ChartXAxisLabel } from '@/features/activity/components/ChartXAxisLabel';
import { ChartYAxisLabel } from '@/features/activity/components/ChartYAxisLabel';
import { StatCard } from '@/features/activity/components/stats/StatCard';
import { SummaryCardSparkline } from '@/features/home/components/SummaryCardSparkline';
import { AttributionOverlay } from '@/features/maps/components/AttributionOverlay';
import { ClusterCountOverlay } from '@/features/maps/components/regional/ClusterCountOverlay';
import { TimelineSlider } from '@/features/maps/components/timeline/TimelineSlider';
import { WellnessTrendsChart } from '@/features/wellness/components/WellnessTrendsChart';
import { ZoneHistogram } from '@/shared/charts/ZoneHistogram';
import type { WellnessData } from '@/types';

/**
 * The surfaces that cannot reflow, named rather than felt: the stats grids,
 * the metric chip rows, the chart axis labels, the tab bar, and the live
 * recording timer and unlock track. A file added here is a claim that its
 * layout breaks at 200 per cent, and a file that reaches for the cap without
 * being here fails this suite.
 */
const DENSE_SURFACES = [
  'src/features/activity/components/ChartTypeSelector.tsx',
  'src/features/activity/components/ChartXAxisLabel.tsx',
  'src/features/activity/components/ChartYAxisLabel.tsx',
  'src/features/activity/components/stats/StatCard.tsx',
  'src/features/recording/components/DataFieldGrid.tsx',
  'src/features/recording/components/TimerHeader.tsx',
  'src/features/recording/components/UnlockTrack.tsx',
  'src/shared/charts/CurveChart.tsx',
  'src/features/fitness/components/FitnessChart.tsx',
  'src/features/fitness/components/FormZoneChart.tsx',
  'src/features/routes/components/section/AttemptHistogramChart.tsx',
  'src/features/routes/components/section/SectionDeltaChart.tsx',
  'src/features/routes/components/section/SectionDeltaSummaryChart.tsx',
  'src/features/routes/components/section/SectionScatterChart.tsx',
  'src/features/stats/components/FTPTrendChart.tsx',
  'src/shared/ui/BottomTabBar.tsx',
  'src/features/wellness/components/WellnessTrendsChart.tsx',
  'src/shared/charts/ZoneHistogram.tsx',
  'src/features/stats/components/ActivityHeatmap.tsx',
  'src/features/maps/components/timeline/TimelineSlider.tsx',
  'src/features/stats/components/SeasonComparison.tsx',
  'src/features/maps/components/regional/ClusterCountOverlay.tsx',
  'src/features/strength/components/ExerciseTable.tsx',
  'src/features/home/components/SummaryCardSparkline.tsx',
  'src/features/stats/components/PowerCurveChart.tsx',
  'src/features/stats/components/PaceCurveChart.tsx',
  'src/features/stats/components/SwimPaceCurveChart.tsx',
  'src/features/maps/components/AttributionOverlay.tsx',
];

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(),
}));

/** Every rendered Text carries the dense cap. */
function expectAllCapped(tree: Awaited<ReturnType<typeof render>>) {
  const caps = capsOf(tree);
  expect(caps.length).toBeGreaterThan(0);
  expect(caps).toStrictEqual(caps.map(() => DENSE_TEXT_SCALE));
}

function flatStyle(node: { props: Record<string, unknown> }): Record<string, unknown> {
  return StyleSheet.flatten(node.props.style as never) ?? {};
}

const WELLNESS_DAYS: WellnessData[] = Array.from({ length: 30 }, (_, i) => ({
  id: `2026-06-${String(i + 1).padStart(2, '0')}`,
  hrv: 60 + (i % 5),
  restingHR: 50,
  weight: 71.5,
}));

/**
 * Every `Text` the tree rendered, with the cap it carries. A chart's Show data link sits below the
 * plot in the flow and wraps like any control, so it keeps the full system size and is not counted.
 */
function capsOf(tree: Awaited<ReturnType<typeof render>>): (number | undefined)[] {
  const links = new Set(
    tree.UNSAFE_queryAllByType(TextLink).flatMap((link) => link.findAllByType(Text))
  );
  return tree
    .UNSAFE_getAllByType(Text)
    .filter((node) => !links.has(node))
    .map((node) => node.props.maxFontSizeMultiplier as number | undefined);
}

describe('the dense text cap', () => {
  it('is 1.3, which is what a dense grid can take', () => {
    expect(DENSE_TEXT_SCALE).toBe(1.3);
  });

  it('rides on every DenseText', async () => {
    const tree = await render(<DenseText>44.2 km</DenseText>);
    expect(capsOf(tree)).toEqual([DENSE_TEXT_SCALE]);
  });

  it('does not stop a caller overriding it deliberately', async () => {
    const tree = await render(<DenseText maxFontSizeMultiplier={2}>44.2 km</DenseText>);
    expect(capsOf(tree)).toEqual([2]);
  });

  it('caps every line of a stats grid card', async () => {
    const tree = await render(
      <StatCard
        stat={{
          title: 'Distance',
          value: '44.2 km',
          icon: 'map-marker-distance',
          color: '#000000',
        }}
        isDark={false}
        onPress={() => {}}
      />
    );
    const caps = capsOf(tree);
    expect(caps.length).toBeGreaterThan(0);
    expect(caps.every((cap) => cap === DENSE_TEXT_SCALE)).toBe(true);
  });

  it('caps the activity plot axis labels and anchors the min label to its measured height', async () => {
    const x = await render(
      <ChartXAxisLabel xAxisMode="distance" maxX={10} xUnit="km" isDark={false} />
    );
    expect(capsOf(x).every((cap) => cap === DENSE_TEXT_SCALE)).toBe(true);

    const series = { range: { min: 0, max: 10 }, config: { color: '#000000' } } as never;
    const y = await render(
      <ChartYAxisLabel
        yAxisSeries={series}
        yAxisAvgInfo={{ normalised: 0.5, raw: 5 }}
        showYAxisAccent={false}
        chartPaddingTop={10}
        chartPaddingBottom={20}
        height={200}
        isDark={false}
        formatYAxisValue={(v) => String(v)}
      />
    );
    expect(capsOf(y).every((cap) => cap === DENSE_TEXT_SCALE)).toBe(true);
    const labels = y.UNSAFE_getAllByType(Text);
    const tops = () =>
      labels.map((n) => {
        const flat = Object.assign({}, ...[n.props.style].flat(Infinity).filter(Boolean));
        return flat.top as number;
      });
    await act(() => {
      labels.forEach((n) => n.props.onLayout({ nativeEvent: { layout: { height: 40 } } }));
    });
    const after = y.UNSAFE_getAllByType(Text).map((n) => {
      const flat = Object.assign({}, ...[n.props.style].flat(Infinity).filter(Boolean));
      return flat.top as number;
    });
    expect(tops()).toBeDefined();
    expect(after[1]).toBe(200 - 20 - 40);
    expect(after[2]).toBe(10 + 0.5 * 170 - 20);
  });

  it('caps every label of a zone histogram, compact and full', async () => {
    for (const count of [5, 7]) {
      const bands = Array.from({ length: count }, (_, i) => ({
        key: i,
        label: `Z${i + 1}`,
        zone: i + 1,
        seconds: 720,
        share: 20,
        primary: '12m',
        secondary: '140-150',
      }));
      expectAllCapped(await render(<ZoneHistogram title="Heart rate zones" bands={bands} />));
    }
  });

  it('caps every wellness row label and lets each row grow past its resting height', async () => {
    const tree = await render(<WellnessTrendsChart data={WELLNESS_DAYS} timeRange="1m" />);
    const container = tree.UNSAFE_getAllByType(View).find((node) => node.props.onLayout);
    await act(async () => {
      await fireEvent(container!, 'layout', {
        nativeEvent: { layout: { width: 360, height: 300 } },
      });
    });
    expectAllCapped(tree);

    const rows = tree.getAllByTestId(/^wellness-row-/);
    expect(rows.length).toBe(3);
    for (const row of rows) {
      const style = flatStyle(row);
      expect(style.height).toBeUndefined();
      expect(style.minHeight).toBeGreaterThan(0);
    }
  });

  it('caps the timeline tick labels and sizes each to its own text', async () => {
    const tree = await render(
      <TimelineSlider
        minDate={new Date(2022, 0, 1)}
        maxDate={new Date(2026, 0, 1)}
        startDate={new Date(2024, 0, 1)}
        endDate={new Date(2026, 0, 1)}
        onRangeChange={() => {}}
      />
    );
    await act(async () => {
      await fireEvent(tree.getByTestId('timeline-slider-track'), 'layout', {
        nativeEvent: { layout: { width: 320, height: 44 } },
      });
    });
    const ticks = tree.getAllByTestId(/^timeline-tick-label-/);
    expect(ticks.length).toBeGreaterThan(2);
    await act(async () => {
      for (const tick of ticks) {
        await fireEvent(tick, 'layout', { nativeEvent: { layout: { width: 41, height: 12 } } });
      }
    });
    expectAllCapped(tree);

    const style = flatStyle(tree.getAllByTestId(/^timeline-tick-label-/).at(-1)!);
    expect(style.width).toBeUndefined();
    expect(style.left).toBe(320 - 41);
  });

  it('caps the cluster counts and sizes their box from the capped text', async () => {
    const surfaceRef = {
      current: {
        queryViewportFeatures: jest.fn(async () => [
          { properties: { cluster_id: 7, point_count: 1234 }, screen: { x: 100, y: 50 } },
        ]),
      },
    } as never;
    jest.useFakeTimers();
    const tree = await render(<ClusterCountOverlay surfaceRef={surfaceRef} visible />);
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    jest.useRealTimers();
    expectAllCapped(tree);
    const box = flatStyle(tree.getByTestId('map-cluster-count-7'));
    expect(box.width).toBeGreaterThan(32);
    expect(box.height).toBeGreaterThan(16);
    expect((box.left as number) + (box.width as number) / 2).toBe(100);
    expect((box.top as number) + (box.height as number) / 2).toBe(50);
  });

  it('caps the home sparkline labels', async () => {
    expectAllCapped(
      await render(
        <SummaryCardSparkline
          fitnessData={[40, 41, 42, 43]}
          formData={[-5, -3, 0, 2]}
          width={300}
          showLabels
        />
      )
    );
  });

  it('caps the map credit, which still wraps rather than truncating', async () => {
    const tree = await render(<AttributionOverlay initialAttribution="© OpenStreetMap" />);
    expectAllCapped(tree);
    expect(tree.getByTestId('map-attribution-text').props.numberOfLines).toBeUndefined();
  });

  it('reaches exactly the named dense surfaces, and no prose one', () => {
    const users = execFileSync(
      'grep',
      ['-rlE', '--include=*.tsx', '--include=*.ts', 'DenseText|DENSE_TEXT_SCALE', 'src'],
      { encoding: 'utf8' }
    )
      .split('\n')
      .filter(Boolean)
      .filter((f) => !f.startsWith('src/__tests__/'))
      // The cap's own modules: where it is defined, re-exported, and read as
      // the large-text threshold, none of which draws text under it.
      .filter(
        (f) =>
          ![
            'src/shared/ui/DenseText.tsx',
            'src/shared/ui/index.ts',
            'src/shared/ui/useLargeText.ts',
          ].includes(f)
      )
      .sort();
    expect(users).toEqual([...DENSE_SURFACES].sort());
  });
});
