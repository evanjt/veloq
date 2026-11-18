// The colours a chart draws in, as the page's custom properties so both colour
// schemes apply. The stream, zone and fitness names come from the app's theme;
// the page's tokens file defines each property from the same values.

import { colourTokens } from '@/theme/colourTokens.generated';

import type { ChartStream } from '../theme';

/** The custom property each activity stream is drawn in. */
const STREAM_PROPERTIES: Record<ChartStream, string> = {
  power: '--colour-stream-power',
  heartrate: '--colour-stream-heartrate',
  cadence: '--colour-stream-cadence',
  speed: '--colour-stream-speed',
  pace: '--colour-stream-speed',
  gap: '--colour-stream-gap',
  wbal: '--colour-stream-wbal',
  elevation: '--colour-stream-context-line',
  temp: '--colour-stream-context-line',
  contextFill: '--colour-stream-context',
  grade: '--colour-data-div-warm-2',
  gradeUp: '--colour-data-div-warm-2',
  gradeDown: '--colour-data-div-cool-2',
  distance: '--colour-stream-context-line',
  time: '--colour-stream-context-line',
};

/** The colour of an activity stream. */
export const streamColour = (stream: ChartStream) => `var(${STREAM_PROPERTIES[stream]})`;

/** The token each compare class (`line-0` to `line-3`) is drawn in, by the table, the chart and the map. */
export const COMPARE_TOKENS: Readonly<Record<string, string>> = {
  'line-0': 'chart-series',
  'line-1': 'stream-speed',
  'line-2': 'sport-foot',
  'line-3': 'sport-ride',
};

/** The compare classes' colours for one scheme, resolved from the token file, for a map paint. */
export function compareColours(tone: 'light' | 'dark'): Readonly<Record<string, string>> {
  const table = colourTokens[tone] as Record<string, string>;
  return Object.fromEntries(
    Object.entries(COMPARE_TOKENS).map(([line, token]) => [line, table[token] as string])
  );
}

/** The colour of heart rate or power zone `n`, from 1 to 7. */
export const zoneColour = (n: number) => `var(--colour-zone-${Math.min(7, Math.max(1, n))})`;

/** The colour of fitness, fatigue and form on the fitness lines. */
export const fitnessColours = {
  fitness: 'var(--colour-fitness-ctl)',
  fatigue: 'var(--colour-fatigue-atl)',
} as const;

/** The fill of a form zone: the form palette, which differs by scheme through the page's tokens. */
export const formZoneColour = (
  zone: 'highRisk' | 'optimal' | 'greyZone' | 'fresh' | 'transition'
) => `var(--role-form${zone[0]?.toUpperCase()}${zone.slice(1)})`;

/** The colour of a record: gold marks achievements and nothing else. */
export const ACHIEVEMENT_COLOUR = 'var(--colour-achievement)';

/** The colour of a section's direction, cool forward against warm reverse. */
export const directionColour = (direction: 'forward' | 'reverse') =>
  `var(--colour-direction-${direction})`;

/** The colour of a wellness metric on its lane. */
export const wellnessColour = (metric: 'hrv' | 'restingHr') =>
  metric === 'hrv' ? 'var(--colour-wellness-hrv)' : 'var(--colour-wellness-rhr)';

/** The colour of the nth line of a comparison or a multi-curve chart, from a distinct hue per line. */
export const curveColour = (n: number) => `var(--colour-${CURVE_TOKENS[n % CURVE_TOKENS.length]})`;

const CURVE_TOKENS = [
  'chart-series',
  'sport-foot',
  'fatigue-atl',
  'stream-speed',
  'sport-ride',
  'stream-power',
] as const;
