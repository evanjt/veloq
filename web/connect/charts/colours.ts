// The colours a chart draws in, as the page's custom properties so both colour
// schemes apply. The stream, zone and fitness names come from the app's theme;
// the page's tokens file defines each property from the same values.

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

/** The colour of heart rate or power zone `n`, from 1 to 7. */
export const zoneColour = (n: number) => `var(--colour-zone-${Math.min(7, Math.max(1, n))})`;

/** The colour of fitness, fatigue and form on the fitness lines. */
export const fitnessColours = {
  fitness: 'var(--colour-fitness-ctl)',
  fatigue: 'var(--colour-fatigue-atl)',
} as const;
