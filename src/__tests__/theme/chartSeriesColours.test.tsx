/**
 * Scenario: a series is read by its colour, so two series in one hue cannot be
 * told apart on the canvas, and one series drawn in two hues reads as two
 * things. Cadence and W'bal plotted in the same orange, the curve charts drew
 * each sport in a hue of their own beside the sport colour every other screen
 * uses, and the feed card drew HRV and resting HR in a pink and a verdict red
 * the wellness charts do not use.
 *
 * Expected behaviour: every measurement stream has a hue no other stream has,
 * speed and pace being one measurement and elevation and temperature grey
 * context, the
 * curve charts draw in the sport colours, and the feed card draws HRV and
 * resting HR in the wellness series colours of the theme it is in, naming each
 * line in text colour rather than its own.
 */

import React from 'react';
import { render, renderHook } from '@testing-library/react-native';
import { Skia } from '@shopify/react-native-skia';

import { SPORT_COLORS } from '@/features/fitness/stores/SportPreferenceStore';
import { SummaryCardHRVSparkline } from '@/features/home/components/SummaryCardHRVSparkline';
import { useChartColors } from '@/shared/charts';
import { chartStreamColors, colors, darkColors } from '@/theme';

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
  it.each(['light', 'dark'] as const)('draw each sport in its sport colour, %s', async (scheme) => {
    mockScheme = scheme;
    const { result } = await renderHook(() => useChartColors());

    expect(result.current.powerCurve).toBe(SPORT_COLORS.Cycling);
    expect(result.current.paceCurve).toBe(SPORT_COLORS.Running);
    expect(result.current.swimCurve).toBe(SPORT_COLORS.Swimming);
  });
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
        showLabels
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
