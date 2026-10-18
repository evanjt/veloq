/**
 * Scenario: a series is read by its colour, so two series in one hue cannot be
 * told apart on the canvas, and one series drawn in two hues reads as two
 * things. Cadence and W'bal plotted in the same orange, the curve charts drew
 * power and pace in a sport hue rather than the hue of the measurement, and
 * the feed card drew HRV and resting HR in a pink and a verdict red
 * the wellness charts do not use.
 *
 * Expected behaviour: every measurement stream has a hue no other stream has,
 * speed and pace being one measurement and elevation and temperature grey
 * context, the
 * curve charts draw in the power and speed stream colours, and the feed card draws HRV and
 * resting HR in the wellness series colours of the theme it is in, naming each
 * line in text colour rather than its own.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, renderHook } from '@testing-library/react-native';
import { Skia } from '@shopify/react-native-skia';

import { FitnessChart } from '@/features/fitness/components/FitnessChart';
import { SummaryCardHRVSparkline } from '@/features/home/components/SummaryCardHRVSparkline';
import { SummaryCardSparkline } from '@/features/home/components/SummaryCardSparkline';
import { ChartCrosshair, useChartColors } from '@/shared/charts';
import { chartStroke } from '@/shared/charts/chartMarks';
import { chartStreamColors, colors, colourTokens, darkColors } from '@/theme';
import type { WellnessData } from '@/types';

import { layoutViews } from '../__shared__/layoutViews';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

let mockScheme: 'light' | 'dark' = 'light';
jest.mock('@/shared/app/ThemeProvider', () => ({
  ...jest.requireActual('@/shared/app/ThemeProvider'),
  useResolvedColorScheme: () => mockScheme,
}));
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: mockScheme === 'dark' }),
}));

afterEach(() => {
  mockScheme = 'light';
  jest.restoreAllMocks();
});

describe.each(['light', 'dark'] as const)('activity stream hues, %s', (theme) => {
  const streams = chartStreamColors[theme];

  it('gives no two measurements the same hue', () => {
    const measurements = [
      'power',
      'heartrate',
      'cadence',
      'speed',
      'gap',
      'wbal',
      'elevation',
      'grade',
    ] as const;
    const owners = new Map<string, string>();
    const shared: string[] = [];
    for (const stream of measurements) {
      const hue = streams[stream].toUpperCase();
      const first = owners.get(hue);
      if (first) shared.push(`${stream} repeats ${first}`);
      else owners.set(hue, stream);
    }

    expect(shared).toEqual([]);
  });

  it('draws pace in the speed hue, one measurement in two units', () => {
    expect(streams.pace).toBe(streams.speed);
  });
});

describe('curve charts', () => {
  it.each(['light', 'dark'] as const)(
    'draw each curve in the colour of what it measures, %s',
    async (scheme) => {
      mockScheme = scheme;
      const { result } = await renderHook(() => useChartColors());
      const tokens = colourTokens[scheme];

      expect(result.current.powerCurve).toBe(tokens['stream-power']);
      expect(result.current.paceCurve).toBe(tokens['stream-speed']);
      expect(result.current.swimCurve).toBe(tokens['stream-speed']);
    }
  );
});

describe('the feed card HRV sparkline', () => {
  async function strokeColours(scheme: 'light' | 'dark') {
    mockScheme = scheme;
    jest
      .spyOn(Skia.Path, 'MakeFromSVGString')
      .mockReturnValue({} as ReturnType<typeof Skia.Path.MakeFromSVGString>);
    const view = await render(
      <SummaryCardHRVSparkline
        hrvData={[52, 58, 61, 55, 60]}
        rhrData={[50, 48, 47, 49, 46]}
        width={300}
      />
    );
    const paths = view.UNSAFE_queryAllByProps({ style: 'stroke' });
    return { view, colours: paths.map((p) => p.props.color as string) };
  }

  it('draws HRV and resting HR in the dark wellness series colours', async () => {
    const { colours } = await strokeColours('dark');

    expect(colours).toContain(darkColors.chartHrv);
    expect(colours).toContain(darkColors.chartRhr);
  });

  it('labels HRV and resting HR in text colour, never in the colour of their lines', async () => {
    const dark = (await strokeColours('dark')).view;
    expect(dark.getByText('metrics.hrv')).toHaveStyle({ color: darkColors.textPrimary });
    expect(dark.getByText('metrics.rhr')).toHaveStyle({ color: darkColors.textPrimary });
    await dark.unmount();

    const light = (await strokeColours('light')).view;
    expect(light.getByText('metrics.hrv')).toHaveStyle({ color: colors.textPrimary });
    expect(light.getByText('metrics.rhr')).toHaveStyle({ color: colors.textPrimary });
  });
});

describe('fitness and fatigue', () => {
  const DAYS = [
    { id: '2026-04-01', ctl: 40, atl: 48 },
    { id: '2026-04-02', ctl: 41, atl: 49 },
    { id: '2026-04-03', ctl: 43, atl: 52 },
  ] as WellnessData[];
  const SERIES = [40, 41, 43, 42, 44, 45, 46];

  function strokes(view: Awaited<ReturnType<typeof render>>) {
    return view
      .UNSAFE_queryAllByProps({ style: 'stroke' })
      .map((p) => p.props.color as string)
      .filter(Boolean);
  }

  it.each(['light', 'dark'] as const)(
    'draw in one hue each on the home sparkline and the Fitness chart, %s',
    async (scheme) => {
      mockScheme = scheme;
      jest
        .spyOn(Skia.Path, 'MakeFromSVGString')
        .mockReturnValue({} as ReturnType<typeof Skia.Path.MakeFromSVGString>);
      const tokens = colourTokens[scheme];

      const sparkline = await render(
        <SummaryCardSparkline
          fitnessData={SERIES}
          fatigueData={SERIES.map((v) => v + 5)}
          formData={SERIES.map((v) => -v / 4)}
          width={300}
        />
      );
      const sparklineStrokes = strokes(sparkline);
      await sparkline.unmount();
      const chart = await render(<FitnessChart data={DAYS} />);
      await layoutViews(chart, 300, 200);
      const chartStrokes = strokes(chart);

      expect(sparklineStrokes).toContain(tokens['fatigue-atl']);
      expect(sparklineStrokes).toContain(tokens['fitness-ctl']);
      expect(chartStrokes).toContain(tokens['fatigue-atl']);
      expect(chartStrokes).toContain(tokens['fitness-ctl']);
      // A line is 2px and holds 3:1 on its own, so nothing is drawn under it.
      expect(sparklineStrokes.sort()).toEqual(
        [tokens['fatigue-atl'], tokens['fitness-ctl']].sort()
      );
      expect(chartStrokes.sort()).toEqual([tokens['fatigue-atl'], tokens['fitness-ctl']].sort());
    }
  );
});

describe('the chart colour owner', () => {
  it.each(['light', 'dark'] as const)(
    'returns the guide token for each piece of chart furniture, %s',
    async (scheme) => {
      mockScheme = scheme;
      const tokens = colourTokens[scheme];
      const { result } = await renderHook(() => useChartColors());

      expect(result.current).toMatchObject({
        grid: tokens['chart-grid'],
        axis: tokens['chart-axis'],
        reference: tokens['chart-reference'],
        crosshair: tokens['chart-crosshair'],
        series: tokens['chart-series'],
        muted: tokens['chart-muted'],
        fitness: tokens['fitness-ctl'],
        fatigue: tokens['fatigue-atl'],
      });
      for (const gone of [
        'casing',
        'primary',
        'secondary',
        'gridFaint',
        'zeroLine',
        'zeroLineSolid',
        'mutedBar',
        'dotMuted',
        'baseline',
      ]) {
        expect(result.current).not.toHaveProperty(gone);
      }
    }
  );

  it.each(['light', 'dark'] as const)(
    'gives the scrub line its colour and width, %s',
    async (scheme) => {
      mockScheme = scheme;
      const view = await render(<ChartCrosshair style={{}} />);
      const line = view.UNSAFE_getByProps({ pointerEvents: 'none' });

      expect(line.props.style).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            backgroundColor: colourTokens[scheme]['chart-crosshair'],
            width: chartStroke.crosshair,
          }),
        ])
      );
    }
  );

  it.each(['light', 'dark'] as const)(
    'draws the home sparklines scrub line as the one scrub line, %s',
    async (scheme) => {
      mockScheme = scheme;
      jest
        .spyOn(Skia.Path, 'MakeFromSVGString')
        .mockReturnValue({} as ReturnType<typeof Skia.Path.MakeFromSVGString>);
      const scrubLines = (view: Awaited<ReturnType<typeof render>>) =>
        view
          .UNSAFE_queryAllByProps({ pointerEvents: 'none' })
          .filter((node) => typeof node.type === 'string')
          .map((node) => StyleSheet.flatten(node.props.style))
          .filter((style) => style?.position === 'absolute' && style.backgroundColor);
      const scrubLine = {
        backgroundColor: colourTokens[scheme]['chart-crosshair'],
        width: chartStroke.crosshair,
      };

      const fitness = await render(
        <SummaryCardSparkline
          fitnessData={SERIES_DAYS}
          fatigueData={SERIES_DAYS}
          formData={SERIES_DAYS}
          width={300}
        />
      );
      expect(scrubLines(fitness)).toEqual([expect.objectContaining(scrubLine)]);
      await fitness.unmount();
      const hrv = await render(
        <SummaryCardHRVSparkline hrvData={SERIES_DAYS} rhrData={SERIES_DAYS} width={300} />
      );
      expect(scrubLines(hrv)).toEqual([expect.objectContaining(scrubLine)]);
    }
  );
});

const SERIES_DAYS = [40, 41, 43, 42, 44, 45, 46];
