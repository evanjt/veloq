/**
 * Scenario: chart text was set at 9, 10 and 11px from a different style in each chart, and
 * several readouts and labels were drawn in the colour of the line or zone they named, which
 * fails contrast on half the fills and leaves the colour as the only key.
 *
 * Expected behaviour: every text a chart renders is at least the 12px chart label, and none
 * wears a series or zone colour: the series is keyed by a dot, swatch or fill beside the text.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RangeCoverage } from 'veloqrs';

import { FitnessChart } from '@/features/fitness/components/FitnessChart';
import { FormZoneChart } from '@/features/fitness/components/FormZoneChart';
import { WellnessTrendsChart } from '@/features/wellness/components/WellnessTrendsChart';
import { ActivityHeatmap } from '@/features/stats/components/ActivityHeatmap';
import { CurveChart } from '@/shared/charts/CurveChart';
import { ZoneHistogram } from '@/shared/charts/ZoneHistogram';
import { TextLink } from '@/shared/ui/TextLink';
import { chartStyles, colors, darkColors, typography, zoneColour } from '@/theme';
import { initialiseI18n } from '@/i18n';
import { getEngine } from '@/shared/native/engine';
import { fitnessScreenRead } from '../__shared__/fitnessScreenRead';
import type { WellnessData } from '@/types';
import { WithScreenRead } from '../__shared__/withScreenRead';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const NEUTRAL_TEXT = new Set(
  [colors, darkColors].flatMap((palette) =>
    Object.entries(palette)
      .filter(([key]) => key.startsWith('text'))
      .map(([, value]) => String(value).toUpperCase())
  )
);

/**
 * Every series, zone and mark tone in both themes, less any that happens to
 * equal a neutral text token.
 */
const SERIES_TONES = new Set(
  [
    ...[colors, darkColors].flatMap((palette) =>
      Object.entries(palette)
        .filter(([key]) => /^(chart|fitness|fatigue|form|zone|mark|sport)/.test(key))
        .map(([, value]) => value)
    ),
    ...[1, 2, 3, 4, 5, 6, 7].flatMap((zone) => [false, true].map((dark) => zoneColour(zone, dark))),
  ]
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.toUpperCase())
    .filter((value) => !NEUTRAL_TEXT.has(value))
);

type Tree = Awaited<ReturnType<typeof render>>;

/** Every Text the chart draws, less its Show data link, which is a control in the link colour. */
function textStyles(tree: Tree) {
  const links = new Set(
    tree.UNSAFE_queryAllByType(TextLink).flatMap((link) => link.findAllByType(Text))
  );
  return tree
    .UNSAFE_getAllByType(Text)
    .filter((node) => !links.has(node))
    .map((node) => ({
      text: [node.props.children].flat(Infinity).join(''),
      style: StyleSheet.flatten(node.props.style) ?? {},
    }));
}

function expectChartText(tree: Tree) {
  const texts = textStyles(tree);
  expect(texts.length).toBeGreaterThan(0);
  const small = texts.filter(({ style }) => (style.fontSize ?? 14) < 12);
  expect(small.map(({ text, style }) => `${text}: ${style.fontSize}`)).toEqual([]);
  const tinted = texts.filter(
    ({ style }) => typeof style.color === 'string' && SERIES_TONES.has(style.color.toUpperCase())
  );
  expect(tinted.map(({ text, style }) => `${text}: ${style.color}`)).toEqual([]);
}

const LOAD_DAYS = Array.from({ length: 14 }, (_, i) => ({
  id: `2026-04-${String(i + 1).padStart(2, '0')}`,
  ctl: 40 + i,
  atl: 48 - (i % 6) * 3,
  rampRate: i % 2 ? 1.4 : -0.8,
  hrv: 60 + (i % 5),
  restingHR: 50,
  weight: 71.5,
})) as WellnessData[];

beforeAll(async () => {
  await initialiseI18n();
});

describe('the chart label role', () => {
  it('is the 12px caption in tabular figures and the secondary text colour', () => {
    const label = StyleSheet.flatten(chartStyles.chartLabel);
    expect(label).toMatchObject({ ...typography.caption, color: colors.textSecondary });
    expect(label?.fontVariant).toEqual(['tabular-nums']);
    expect(StyleSheet.flatten([chartStyles.chartLabel, chartStyles.chartLabelDark])?.color).toBe(
      darkColors.textSecondary
    );
  });

  it('has a strong twin in the primary text colour, for lane titles and direct labels', () => {
    const strong = StyleSheet.flatten(chartStyles.chartLabelStrong);
    expect(strong).toMatchObject({ ...typography.caption, color: colors.textPrimary });
    expect(
      StyleSheet.flatten([chartStyles.chartLabelStrong, chartStyles.chartLabelStrongDark])?.color
    ).toBe(darkColors.textPrimary);
  });
});

describe('chart text', () => {
  it('is never below 12px nor in a series colour on the fitness chart, pinned on a marked day', async () => {
    const markers = [
      { date: '2026-04-05', eftp: 260, delta: 10, activityId: 'a1', activityName: 'Hill repeats' },
    ];
    expectChartText(
      await render(<FitnessChart data={LOAD_DAYS} markers={markers} selectedDate="2026-04-05" />)
    );
    expectChartText(await render(<FitnessChart data={LOAD_DAYS} />));
  });

  it('keys the fitness readout values by a dot in the series colour rather than by the text', async () => {
    const tree = await render(<FitnessChart data={LOAD_DAYS} />);
    expect(tree.getByTestId('fitness-ctl-key')).toBeTruthy();
    expect(tree.getByTestId('fitness-atl-key')).toBeTruthy();
    expect(tree.getByTestId('fitness-form-key')).toBeTruthy();
    for (const id of ['fitness-ctl-value', 'fitness-atl-value', 'fitness-form-value']) {
      expect(StyleSheet.flatten(tree.getByTestId(id).props.style).fontVariant).toEqual([
        'tabular-nums',
      ]);
    }
  });

  it('is never below 12px nor in a zone colour on the form chart', async () => {
    expectChartText(await render(<FormZoneChart data={LOAD_DAYS} />));
  });

  it('is never below 12px nor in a zone colour on a zone histogram, compact and full', async () => {
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
      expectChartText(await render(<ZoneHistogram title="Heart rate zones" bands={bands} />));
    }
  });

  it('is never below 12px on the wellness lanes, and the readout keeps one width per digit', async () => {
    const tree = await render(<WellnessTrendsChart data={LOAD_DAYS} timeRange="1m" />);
    const container = tree.UNSAFE_getAllByType(View).find((node) => node.props.onLayout);
    await act(async () => {
      await fireEvent(container!, 'layout', {
        nativeEvent: { layout: { width: 360, height: 300 } },
      });
    });
    expectChartText(tree);
    const readouts = tree.getAllByTestId(/^wellness-value-/);
    expect(readouts.length).toBe(3);
    for (const readout of readouts) {
      expect(StyleSheet.flatten(readout.props.style).fontVariant).toEqual(['tabular-nums']);
    }
  });

  it('is never below 12px on a curve chart', async () => {
    expectChartText(
      await render(
        <CurveChart
          data={[
            { x: 1, y: 300 },
            { x: 60, y: 250 },
            { x: 600, y: 210 },
          ]}
          yDomain={[200, 320]}
          color={colors.chartFtp}
          xLabels={[
            { label: '1s', value: 1 },
            { label: '10m', value: 600 },
          ]}
          formatY={(v) => String(Math.round(v))}
          reading={{
            title: 'Power',
            xHeader: 'Duration',
            formatX: (x) => `${x}s`,
            shape: 'curve',
          }}
        />
      )
    );
  });

  it('is never below 12px on the activity calendar', async () => {
    const day = '2026-06-15';
    (getEngine as jest.MockedFunction<typeof getEngine>).mockReturnValue({
      subscribe: () => () => {},
      getFitnessScreenData: fitnessScreenRead({
        heatmap: () => [{ date: day, intensity: 2, maxDuration: 3900, activityCount: 1 }],
      }),
      getActivityBodies: jest.fn(() => ({ bodies: [], intervalsIds: [] })),
      rangeCoverage: jest.fn(() => RangeCoverage.NotFetched),
    } as unknown as ReturnType<typeof getEngine>);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = await render(
      <WithScreenRead>{(training) => <ActivityHeatmap training={training} />}</WithScreenRead>,
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={client}>{children}</QueryClientProvider>
        ),
      }
    );
    await waitFor(() => expect(tree.getByTestId('activity-heatmap-count')).toBeTruthy());
    expectChartText(tree);
  });
});
