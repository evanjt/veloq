#!/usr/bin/env tsx
// Draws the connect site's page spec as mock-ups: every page at 1440x900 and
// 2560x1440 in both colour schemes. Each mock-up is the page itself on the
// demo phone in the browser harness, its map, charts and tables moved into the
// arrangement the spec draws, with what the page does not have yet built from
// the kit's classes and the generated tokens. Nothing here changes the site.
//
// Usage: npm run connect:mockups [-- --out <dir>] [--pages activity,sections] [--sizes 1440x900]
//
// `--out` defaults to `connect-screenshots/mockups/`, which is git-ignored.
// The directory holds one PNG per page, size and scheme, and `index.html`.

import { resolve } from 'node:path';

import { buildSync } from 'esbuild';

import { SHOWN_ACTIVITY } from '../src/__tests__/__shared__/connectDemoLibrary';
import { captureScreenshots, exitStatus, type Capture, type Size } from './connect-screenshots';

export const MOCKUP_SIZES: Size[] = [
  { width: 1440, height: 900 },
  { width: 2560, height: 1440 },
];

const has = (selector: string) => `document.querySelector(${JSON.stringify(selector)}) !== null`;

/** Each page of the spec: where the page is opened, when it has drawn, and its arrangement. */
export const MOCKUPS: Record<string, { hash: string; ready: string }> = {
  activities: {
    hash: '#/activities',
    ready: `document.querySelectorAll('#feed-scroll tbody tr').length > 5`,
  },
  activity: {
    hash: `#/activity/${SHOWN_ACTIVITY}`,
    ready: `document.querySelectorAll('#activity-summary dt').length > 3 && document.querySelectorAll('#activity-lanes .lane').length > 2`,
  },
  compare: { hash: '#/route/route-0', ready: has('#route-attempts tbody tr[data-row]') },
  map: {
    hash: '#/map',
    ready: `${has('canvas.maplibregl-canvas')} && ${has('#map-list tbody tr')}`,
  },
  routes: { hash: '#/routes', ready: has('#routes-list tbody tr') },
  route: {
    hash: '#/route/route-0',
    ready: `${has('#route-attempts tbody tr[data-row]')} && ${has('#panel-time figure')}`,
  },
  sections: {
    hash: '#/sections',
    ready: `[...document.querySelectorAll('.filter-bar button')].some((b) => /to review/.test(b.textContent) && !b.disabled)`,
  },
  section: {
    hash: '#/section/section-0',
    ready: `${has('#section-body .section-name')} && ${has('#panel-time figure')}`,
  },
  fitness: {
    hash: '#/fitness',
    ready: `${has('#fitness-tiles')} && ${has('#panel-wellness-lanes figure')}`,
  },
  insights: { hash: '#/insights', ready: has('#ranked-sections tbody tr') },
  strength: {
    hash: '#/strength?period=3m',
    ready: `${has('#strength-exercises tbody tr')} && ${has('#strength-balance li')}`,
  },
  exercise: { hash: '#/exercise/0', ready: has('#exercise-sessions tbody tr') },
  workouts: { hash: '#/workouts', ready: has('#workouts-saved tbody tr') },
  workout: {
    hash: '#/workout/workout-1',
    ready: `${has('#workout-exercises li')} && ${has('#workout-picker tbody tr')}`,
  },
  recordings: { hash: '#/recordings', ready: has('#recordings-list tr[data-row]') },
  recording: { hash: '#/recording/recording-1', ready: has('#recording-stats dt') },
  settings: { hash: '#/settings/thresholds-settings', ready: has('#settings-zones-Ride tbody tr') },
};

/** The arrangements, bundled once into a script the page runs. */
function arrangementScript(): string {
  const built = buildSync({
    entryPoints: [resolve(__dirname, 'connect-mockups/pages.ts')],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    write: false,
  });
  const output = built.outputFiles[0];
  if (!output) throw new Error('the arrangements did not bundle');
  return output.text;
}

/** The screenshot tool's captures for each mock-up, its arrangement run once the page has drawn. */
export function mockupCaptures(names: string[]): Record<string, Capture> {
  const script = arrangementScript();
  const captures: Record<string, Capture> = {};
  for (const name of names) {
    const mockup = MOCKUPS[name];
    if (!mockup)
      throw new Error(`no mock-up named ${name}; they are ${Object.keys(MOCKUPS).join(', ')}`);
    captures[name] = {
      hash: mockup.hash,
      ready: mockup.ready,
      then: {
        do: `${script}\nwindow.mockRun(${JSON.stringify(name)})`,
        until: `(() => { if (window.mockError) throw new Error(window.mockError); return window.mockDone === true; })()`,
      },
      check: `window.mockCheck(${JSON.stringify(name)}, window.shot)`,
    };
  }
  return captures;
}

function argument(flag: string): string | undefined {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

if (require.main === module) {
  const names = argument('--pages')?.split(',') ?? Object.keys(MOCKUPS);
  const sizes = argument('--sizes')
    ?.split(',')
    .map((text) => {
      const [width, height] = text.split('x').map(Number);
      return { width: width as number, height: height as number };
    });
  captureScreenshots({
    out: resolve(argument('--out') ?? 'connect-screenshots/mockups'),
    captures: mockupCaptures(names),
    routes: names,
    sizes: sizes ?? MOCKUP_SIZES,
  }).then(
    (report) => {
      for (const failure of report.failed) {
        console.error(
          `${failure.name} at ${failure.size.width} in ${failure.scheme}: ${failure.message}`
        );
      }
      console.log(
        `wrote ${report.written.length} mock-ups` +
          (report.failed.length > 0 ? `, ${report.failed.length} failed` : '')
      );
      process.exitCode = exitStatus(report);
    },
    (error) => {
      console.error(String(error.message ?? error));
      process.exit(1);
    }
  );
}
