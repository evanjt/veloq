/**
 * Scenario: the style guide gives the data colours as tokens, one value per
 * theme: a colour per activity stream, a family colour per sport, a five-step
 * sequential ramp, a diverging ramp of three steps each side of a grey
 * midpoint, a direction pair, and one hue each for fitness and fatigue. The app
 * held its own hand-picked set, one value for both themes, and drew fatigue in
 * pink on the home sparkline and the widgets and in purple on the charts.
 *
 * Expected behaviour: every data colour owner returns its token's value in the
 * theme it is asked for, and every surface that draws fitness or fatigue reads
 * the same hue in the same theme.
 */

import { renderHook } from '@testing-library/react-native';

import { formZoneColor } from '@/features/fitness/lib/fitness';
import { summaryFormZoneColor, summarySeriesColor } from '@/features/home/lib/summaryMetricColour';
import { useChartColors } from '@/shared/charts';
import { widgetPalette } from '@/shared/theme/widgetTheme';
import {
  bodyDiagram,
  chartStreamColour,
  colourTokens,
  colors,
  contributionRamp,
  darkColors,
  directionPair,
  divergingRamp,
  sequentialRamp,
  sportFamilyColours,
} from '@/theme';

let mockScheme: 'light' | 'dark' = 'light';
jest.mock('@/shared/app/ThemeProvider', () => ({
  ...jest.requireActual('@/shared/app/ThemeProvider'),
  useResolvedColorScheme: () => mockScheme,
}));

afterEach(() => {
  mockScheme = 'light';
});

const THEMES = ['light', 'dark'] as const;
const palette = (theme: (typeof THEMES)[number]) => (theme === 'dark' ? darkColors : colors);

describe.each(THEMES)('the %s theme', (theme) => {
  const token = colourTokens[theme];
  const isDark = theme === 'dark';

  it('draws each stream in its stream token, speed and pace as one measurement', () => {
    expect(chartStreamColour('power', isDark)).toBe(token['stream-power']);
    expect(chartStreamColour('heartrate', isDark)).toBe(token['stream-heartrate']);
    expect(chartStreamColour('cadence', isDark)).toBe(token['stream-cadence']);
    expect(chartStreamColour('speed', isDark)).toBe(token['stream-speed']);
    expect(chartStreamColour('pace', isDark)).toBe(token['stream-speed']);
    expect(chartStreamColour('gap', isDark)).toBe(token['stream-gap']);
    expect(chartStreamColour('wbal', isDark)).toBe(token['stream-wbal']);
  });

  it('draws elevation and temperature as grey context, its edge carrying the contrast', () => {
    expect(chartStreamColour('elevation', isDark)).toBe(token['stream-context-line']);
    expect(chartStreamColour('temp', isDark)).toBe(token['stream-context-line']);
    expect(chartStreamColour('contextFill', isDark)).toBe(token['stream-context']);
  });

  it('draws grade from the diverging ramp, warm uphill and cool downhill', () => {
    expect(chartStreamColour('grade', isDark)).toBe(token['data-div-warm-2']);
    expect(chartStreamColour('gradeUp', isDark)).toBe(token['data-div-warm-2']);
    expect(chartStreamColour('gradeDown', isDark)).toBe(token['data-div-cool-2']);
  });

  it('keeps the six identity streams apart', () => {
    const identity = (['power', 'heartrate', 'cadence', 'speed', 'gap', 'wbal'] as const).map(
      (stream) => chartStreamColour(stream, isDark)
    );

    expect(new Set(identity).size).toBe(identity.length);
  });

  it('runs the sequential ramp through the five data-seq steps', () => {
    const steps = [1, 2, 3, 4, 5].map((n) => token[`data-seq-${n}` as keyof typeof token]);

    expect(sequentialRamp[theme]).toEqual(steps);
    expect(contributionRamp[theme]).toEqual([token['fill-neutral'], ...steps.slice(0, 4)]);
    expect(isDark ? bodyDiagram.fillDark : bodyDiagram.fillLight).toBe(token['fill-neutral']);
  });

  it('runs the diverging ramp from the grey midpoint out to three steps each side', () => {
    expect(divergingRamp[theme]).toEqual({
      cool: [token['data-div-cool-1'], token['data-div-cool-2'], token['data-div-cool-3']],
      mid: token['data-div-mid'],
      warm: [token['data-div-warm-1'], token['data-div-warm-2'], token['data-div-warm-3']],
    });
  });

  it('draws the form zones on the diverging ramp, fresh cool and high risk warm', () => {
    const p = palette(theme);

    expect(p.formTransition).toBe(token['data-div-cool-3']);
    expect(p.formFresh).toBe(token['data-div-cool-1']);
    expect(p.formGreyZone).toBe(token['data-div-mid']);
    expect(p.formOptimal).toBe(token['data-div-warm-1']);
    expect(p.formHighRisk).toBe(token['data-div-warm-3']);
    expect(formZoneColor('transition', isDark)).toBe(token['data-div-cool-3']);
    expect(formZoneColor('fresh', isDark)).toBe(token['data-div-cool-1']);
    expect(formZoneColor('greyZone', isDark)).toBe(token['data-div-mid']);
    expect(formZoneColor('optimal', isDark)).toBe(token['data-div-warm-1']);
    expect(formZoneColor('highRisk', isDark)).toBe(token['data-div-warm-3']);
  });

  it('draws forward and reverse in the direction pair', () => {
    expect(directionPair[theme].forward).toBe(token['direction-forward']);
    expect(directionPair[theme].reverse).toBe(token['direction-reverse']);
  });

  it('gives each sport family its colour and its two fixed sub-shades, other a grey', () => {
    for (const [family, name] of [
      ['Ride', 'ride'],
      ['Winter', 'winter'],
      ['Run', 'run'],
      ['Water', 'water'],
      ['Foot', 'foot'],
      ['Strength', 'strength'],
    ] as const) {
      expect(sportFamilyColours[theme][family]).toEqual([
        token[`sport-${name}`],
        token[`sport-${name}-2`],
        token[`sport-${name}-3`],
      ]);
    }
    expect(sportFamilyColours[theme].Other).toEqual([token['sport-other']]);
  });

  it('draws fitness and fatigue in one hue each on the charts, the home card and the widget', async () => {
    mockScheme = theme;
    const { result } = await renderHook(() => useChartColors());
    const widget = widgetPalette[theme];

    for (const fitness of [
      palette(theme).fitness,
      result.current.fitness,
      summarySeriesColor('fitness', isDark),
      widget.chartFitness,
    ]) {
      expect(fitness).toBe(token['fitness-ctl']);
    }
    for (const fatigue of [
      palette(theme).fatigue,
      result.current.fatigue,
      summarySeriesColor('fatigue', isDark),
      widget.chartFatigue,
      widget.fatigue,
    ]) {
      expect(fatigue).toBe(token['fatigue-atl']);
    }
  });

  it('draws the widget form zones in the theme the widget is in', () => {
    const widget = widgetPalette[theme];

    expect(widget.formHighRisk).toBe(token['data-div-warm-3']);
    expect(summaryFormZoneColor('fresh', isDark)).toBe(token['data-div-cool-1']);
    expect(widget.formFresh).toBe(token['data-div-cool-1']);
    expect(widget.strengthRamp).toEqual(sequentialRamp[theme]);
    expect(widget.bodyFill).toBe(token['fill-neutral']);
  });
});
