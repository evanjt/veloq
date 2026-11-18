#!/usr/bin/env tsx
// Renders every connect page at three large-screen sizes in both colour schemes,
// from a scripted phone holding the demo library, and writes the PNGs, the
// axe-core report beside each one and a contact sheet. The page is built the way
// the deploy builds it and runs in the browser harness the page's own tests use,
// so nothing here reaches a network.
//
// Usage: npm run connect:screenshots [-- --out <dir>] [--routes feed,map] [--sizes 1280x800]
//
// `--out` defaults to `connect-screenshots/`, which is git-ignored.

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { phoneScript } from '../src/__tests__/__shared__/connectPhoneScripts';
import { SHOWN_ACTIVITY, UNTRACKED_ACTIVITY } from '../src/__tests__/__shared__/connectDemoLibrary';
import {
  buildPage,
  findChromium,
  launchConnectBrowser,
  type ConnectBrowser,
  type ConnectPage,
  type Script,
} from '../src/__tests__/__shared__/headlessConnectPage';

export interface Size {
  width: number;
  height: number;
}

/** The sizes the owner reviews on a large screen. `--sizes` takes others, such as 1280x800. */
export const SIZES: Size[] = [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
];

/** Injected into each page, so no capture depends on a copy the page loads itself. */
const AXE_SOURCE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

/** A violation of these fails the run. Lesser impacts are written beside the PNG and pass. */
const BLOCKING_IMPACTS = new Set(['serious', 'critical']);

interface Violation {
  id: string;
  impact: string | null | undefined;
  help: string;
  helpUrl: string;
  targets: string[];
}

const SCHEMES = ['light', 'dark'] as const;
type Scheme = (typeof SCHEMES)[number];

export type Capture = {
  /** The hash the page is sent to; absent leaves it where the connection puts it. */
  hash?: string;
  /** A phone that never answers, or answers with a failure, instead of the demo library. */
  phone?: 'unpaired' | 'failing' | 'behind';
  /** Opens each shot in a browser of its own, so no storage from an earlier shot is shown. */
  fresh?: true;
  /** An expression true once the screen has drawn its content. */
  ready: string;
  /** What is done once it has, and an expression true when that has taken effect. */
  then?: { do: string; until: string };
  /**
   * An expression awaited in the page once the PNG is taken, with the PNG as a data URL in
   * `window.shot`. A string it gives is the reason the capture is wrong; anything else passes.
   */
  check?: string;
};

const has = (selector: string) => `document.querySelector(${JSON.stringify(selector)}) !== null`;

/** Every page, by the name its files carry. Each ready check reads an id the screen renders. */
export const ROUTES: Record<string, Capture> = {
  feed: {
    hash: '#/activities',
    ready: `document.querySelectorAll('#feed-scroll tbody tr').length > 5`,
  },
  activity: {
    hash: `#/activity/${SHOWN_ACTIVITY}`,
    ready: `document.querySelectorAll('#activity-summary dt').length > 3`,
  },
  // A range of the ride cut as a section: grips on the track, the distances and the name.
  'activity-create-section': {
    hash: `#/activity/${SHOWN_ACTIVITY}`,
    ready: `document.querySelectorAll('#activity-summary dt').length > 3`,
    then: {
      do: `[...document.querySelectorAll('#activity-header button')].find((b) => b.textContent === 'Create section')?.click()`,
      until: has('#create-section'),
    },
  },
  'activity-charts': {
    hash: `#/activity/${SHOWN_ACTIVITY}`,
    ready: `document.querySelectorAll('#activity-lanes .lane').length > 2`,
    // The charts and the tables under them, which sit below the fold of the first screen.
    then: {
      do: `document.querySelector('#activity-lanes').scrollIntoView({ block: 'start' })`,
      until: 'true',
    },
  },
  'activity-coloured': {
    hash: `#/activity/${SHOWN_ACTIVITY}`,
    ready: `document.querySelectorAll('#activity-summary dt').length > 3 && document.querySelector('#activity-colour') !== null`,
    // The track shaded by grade, with the pointer resting halfway along the charts.
    then: {
      do: `[...document.querySelectorAll('#activity-colour button')].at(-1)?.click();
        const svg = document.querySelector('#activity-lanes svg');
        const box = svg.getBoundingClientRect();
        svg.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: box.left + box.width / 2, clientY: box.top + 40 }))`,
      until: has('#crosshair-reading:not(:empty)'),
    },
  },
  'activity-no-gps': {
    hash: `#/activity/${UNTRACKED_ACTIVITY}`,
    ready: has('#map-empty') + ` && document.querySelectorAll('#activity-summary dt').length > 2`,
  },
  fitness: { hash: '#/fitness', ready: has('#fitness-tiles') },
  'fitness-calendar': { hash: '#/fitness?tab=calendar', ready: has('#months tbody tr') },
  'fitness-performance': {
    hash: '#/fitness?tab=performance',
    ready: has('#fitness-page figure.chart'),
  },
  'fitness-trends': { hash: '#/fitness?tab=trends', ready: has('#fitness-page figure.chart') },
  insights: { hash: '#/insights', ready: has('#ranked-sections tbody tr') },
  map: {
    hash: '#/map',
    ready: has('canvas.maplibregl-canvas'),
    // Frames the library's own activities, which the map does not open on.
    then: {
      do: `[...document.querySelectorAll('button')].find((b) => b.textContent === 'Fit all activities')?.click()`,
      until: 'true',
    },
  },
  // The selection panel open on an activity, the markers coloured by age.
  'map-selected': {
    hash: `#/map?selected=${encodeURIComponent(`activity:${SHOWN_ACTIVITY}`)}&colour=recency`,
    ready: has('#map-selection h2'),
  },
  // The panel folded to its chip.
  'map-collapsed': { hash: '#/map?panel=closed', ready: has('#map-chip') },
  // A section picked from its list, and the list pane holding sections.
  'map-section': {
    hash: `#/map?list=sections&selected=${encodeURIComponent('section:section-0')}`,
    ready: has('#map-selection h2'),
  },
  routes: { hash: '#/routes', ready: has('#routes-list tbody tr') },
  sections: { hash: '#/sections', ready: has('#sections-list tbody tr') },
  settings: {
    hash: '#/settings',
    ready: has('#settings-profile tbody tr'),
  },
  'settings-display': {
    hash: '#/settings/display-settings',
    ready: has('#settings-rows li'),
  },
  'settings-thresholds': {
    hash: '#/settings/thresholds-settings',
    ready: has('#settings-zones-Ride tbody tr'),
  },
  'settings-backup': {
    hash: '#/settings/backup-settings',
    ready: has('#settings-backup dd'),
  },
  route: { hash: '#/route/route-0', ready: has('#route-attempts tbody tr[data-row]') },
  // A view of the route's attempts chosen by its tab, and an attempt chosen in the table.
  'route-spread': {
    hash: '#/route/route-0',
    ready: has('#route-attempts tbody tr[data-row]'),
    then: {
      do: `document.querySelector('#routes-detail [role="tab"]:nth-child(2)')?.click()`,
      until: has('#routes-detail figure.chart .mark-bar'),
    },
  },
  'route-delta': {
    hash: '#/route/route-0',
    ready: has('#route-attempts tbody tr[data-row]'),
    then: {
      do: `document.querySelector('#route-attempts tbody tr[data-row]')?.click(); document.querySelector('#routes-detail [role="tab"]:nth-child(3)')?.click()`,
      until: has('#routes-detail figure.chart .mark-line'),
    },
  },
  'route-selected': {
    hash: '#/route/route-0',
    ready: has('#route-attempts tbody tr[data-row]'),
    then: {
      do: `document.querySelectorAll('#route-attempts tbody tr[data-row]')[2]?.click()`,
      until: `document.querySelector('#route-attempts tr[aria-selected="true"]') !== null`,
    },
  },
  'sections-selected': {
    hash: '#/sections?selected=section-0',
    ready: has('#sections-selection .panel-title'),
  },
  'sections-retired': { hash: '#/sections?view=retired', ready: has('#sections-list tbody tr') },
  // The review queue: the primary button names the sections awaiting acceptance and is enabled,
  // and a row awaiting acceptance is in the list.
  'sections-review': {
    hash: '#/sections',
    ready: `[...document.querySelectorAll('.filter-bar button')].some((b) => /to review/.test(b.textContent) && !b.disabled) && ${has('#sections-list tbody tr[data-row="section-5"]')}`,
  },
  section: { hash: '#/section/section-0', ready: has('#section-body .section-name') },
  // The ends of the section's line as two grips on the map, with the length and grade between them.
  'section-edit-bounds': {
    hash: '#/section/section-0',
    ready: has('#section-body .section-name'),
    then: {
      do: `[...document.querySelectorAll('.section-actions button')].find((b) => b.textContent === 'Edit bounds')?.click()`,
      until: has('#section-editor'),
    },
  },
  // The same editor with the ride's own track shown beyond the ends.
  'section-edit-beyond': {
    hash: '#/section/section-0',
    ready: has('#section-body .section-name'),
    then: {
      do: `[...document.querySelectorAll('.section-actions button')].find((b) => b.textContent === 'Edit bounds')?.click();
        setTimeout(() => [...document.querySelectorAll('#section-editor button')].find((b) => b.textContent === 'Beyond the ends')?.click(), 400)`,
      until: `document.querySelector('#section-editor [aria-pressed="true"]')?.textContent === 'Beyond the ends'`,
    },
  },
  // A neighbour chosen to merge, drawn beside the section in its own colour.
  'section-merge-chosen': {
    hash: '#/section/section-0?tab=merge&candidate=section-1',
    ready: has('#section-body tbody tr'),
  },
  'section-spread': {
    hash: '#/section/section-0?tab=spread',
    ready: has('#section-body svg'),
  },
  'section-delta': {
    hash: '#/section/section-0?tab=delta',
    ready: has('#section-body svg'),
  },
  'section-laps': {
    hash: '#/section/section-0?tab=laps',
    ready: has('#section-body tbody tr'),
  },
  'section-history': {
    hash: '#/section/section-0?tab=history',
    ready: has('#section-body .history li'),
  },
  'section-merge': {
    hash: '#/section/section-0?tab=merge',
    ready: has('#section-body tbody tr'),
  },
  strength: {
    hash: '#/strength?period=3m',
    ready: has('#strength-exercises tbody tr') + ' && ' + has('#strength-balance li'),
  },
  'strength-tables': {
    hash: '#/strength?period=3m',
    ready: has('#strength-weeks tbody tr'),
    then: {
      do: `document.querySelector('.strength-tables')?.scrollIntoView({ block: 'start' })`,
      until: 'true',
    },
  },
  'strength-muscle': {
    hash: '#/strength?period=3m&muscle=chest',
    ready: has('#strength-exercises tbody tr') + ' && ' + has('.body-figure-muscle[data-chosen]'),
  },
  exercise: { hash: '#/exercise/0', ready: has('#exercise-sessions tbody tr') },
  recordings: { hash: '#/recordings', ready: has('#recordings-list tr[data-row]') },
  recording: { hash: '#/recording/recording-1', ready: has('#recording-stats dt') },
  workouts: { hash: '#/workouts', ready: has('#workouts-saved tbody tr') },
  'workouts-edit': {
    hash: '#/workout/workout-1',
    ready: has('#workout-exercises li') + ' && ' + has('#workout-picker tbody tr'),
  },
  live: { hash: '#/live', ready: has('#live-sets-table tbody tr') },
  pairing: { phone: 'unpaired', fresh: true, ready: has('#pair #code') },
  // Every read the phone is asked fails, and each panel says so in place while the link stays up.
  errors: {
    phone: 'failing',
    fresh: true,
    hash: '#/activities',
    ready: `${has('[data-read-error="failed"]')} && ${has('#status[data-state="connected"]')}`,
  },
  // A phone one app version behind lists only the feed's reads: each panel that needs another
  // says to update the phone, in place.
  'behind-activity': {
    phone: 'behind',
    fresh: true,
    hash: `#/activity/${SHOWN_ACTIVITY}`,
    ready: has('[data-read-error="unsupported"]'),
  },
  'behind-fitness': {
    phone: 'behind',
    fresh: true,
    hash: '#/fitness',
    ready: has('#panel-wellness [data-read-error="unsupported"]'),
  },
  'behind-routes': {
    phone: 'behind',
    fresh: true,
    hash: '#/routes',
    ready: has('[data-read-error="unsupported"]'),
  },
  'behind-strength': {
    phone: 'behind',
    fresh: true,
    hash: '#/insights?type=strength',
    ready: has('[data-read-error="unsupported"]'),
  },
};

const AXE_RUN = `axe.run(document).then((result) => result.violations.map((violation) => ({
  id: violation.id,
  impact: violation.impact,
  help: violation.help,
  helpUrl: violation.helpUrl,
  targets: violation.nodes.map((node) => node.target.join(' ')),
})))`;

/** Runs axe-core over the page as it is now, and returns its violations. */
async function audit(page: ConnectPage): Promise<Violation[]> {
  await page.evaluate(`${AXE_SOURCE}\n;true`);
  return page.evaluate<Violation[]>(AXE_RUN);
}

const describeViolation = (violation: Violation) =>
  `${violation.id} (${violation.impact}): ${violation.help}, at ${violation.targets.join('; ')}`;

const scriptFor = (kind: Capture['phone']): Promise<Script> => phoneScript(kind ?? 'demo');

const settle = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function shoot(
  page: ConnectPage,
  capture: Capture,
  timeoutMs: number
): Promise<{ png: Buffer; problem: string | null }> {
  if (capture.phone !== 'unpaired') {
    await page.until(
      `document.querySelector('#status[data-state="connected"]') !== null`,
      timeoutMs
    );
    if (capture.hash) await page.evaluate(`location.hash = ${JSON.stringify(capture.hash)}`);
  }
  await page.until(capture.ready, timeoutMs);
  if (capture.then) {
    await page.evaluate(capture.then.do);
    await page.until(capture.then.until, timeoutMs);
    await settle(2_000);
  }
  await settle(1_200);
  const png = await page.screenshot();
  if (!capture.check) return { png, problem: null };
  await page.evaluate(
    `window.shot = ${JSON.stringify(`data:image/png;base64,${png.toString('base64')}`)}`
  );
  const verdict = await page.evaluate<unknown>(capture.check);
  return { png, problem: typeof verdict === 'string' ? verdict : null };
}

export interface Options {
  out: string;
  routes?: string[];
  sizes?: Size[];
  chromium?: string;
  /** The captures by name; the connect page's own routes unless a run names others. */
  captures?: Record<string, Capture>;
  /** How long each wait for the phone or a ready check may take. */
  timeoutMs?: number;
}

/** One capture that did not produce its PNG. */
export interface Failure {
  name: string;
  size: Size;
  scheme: Scheme;
  message: string;
}

export interface Report {
  /** The files written, in the order the captures ran. */
  written: string[];
  failed: Failure[];
}

/** The process exit status for a run: zero only when every capture was written. */
export function exitStatus(report: Report): number {
  return report.failed.length > 0 ? 1 : 0;
}

/**
 * Writes `<route>-<width>-<scheme>.png` and its `.axe.json` violations for each
 * route, size and scheme, and `index.html`. A capture that fails, or whose page
 * has a serious or critical violation, is reported and the rest still run.
 */
export async function captureScreenshots(options: Options): Promise<Report> {
  const captures = options.captures ?? ROUTES;
  const names = options.routes ?? Object.keys(captures);
  const unknown = names.filter((name) => !(name in captures));
  if (unknown.length > 0) {
    throw new Error(
      `no such route: ${unknown.join(', ')}; the routes are ${Object.keys(captures).join(', ')}`
    );
  }
  const executable = options.chromium ?? findChromium();
  if (!executable) throw new Error('no Chromium found; set CHROME_PATH');
  const sizes = options.sizes ?? SIZES;
  const timeoutMs = options.timeoutMs ?? 30_000;

  rmSync(options.out, { recursive: true, force: true });
  mkdirSync(options.out, { recursive: true });
  const built = buildPage();
  let shared: ConnectBrowser | null = null;
  const report: Report = { written: [], failed: [] };
  try {
    shared = await launchConnectBrowser(executable, built.dir);
    for (const name of names) {
      const capture = captures[name] as Capture;
      const script = await scriptFor(capture.phone);
      for (const size of sizes) {
        for (const scheme of SCHEMES) {
          const browser = capture.fresh
            ? await launchConnectBrowser(executable, built.dir)
            : (shared as ConnectBrowser);
          let page: ConnectPage | null = null;
          try {
            page = await browser.open(script, 'en', { ...size, scheme });
            const { png, problem } = await shoot(page, capture, timeoutMs);
            const stem = `${name}-${size.width}-${scheme}`;
            writeFileSync(resolve(options.out, `${stem}.png`), png);
            report.written.push(`${stem}.png`);
            if (problem !== null) report.failed.push({ name, size, scheme, message: problem });
            const violations = await audit(page);
            writeFileSync(
              resolve(options.out, `${stem}.axe.json`),
              JSON.stringify(violations, null, 2)
            );
            const blocking = violations.filter((violation) =>
              BLOCKING_IMPACTS.has(violation.impact ?? '')
            );
            if (blocking.length > 0) {
              report.failed.push({
                name,
                size,
                scheme,
                message: blocking.map(describeViolation).join('\n'),
              });
            }
          } catch (error) {
            report.failed.push({
              name,
              size,
              scheme,
              message: [(error as Error).message, ...(page?.errors() ?? [])].join('\n'),
            });
          } finally {
            await page?.close();
            if (capture.fresh) await browser.close();
          }
        }
      }
    }
  } finally {
    await shared?.close();
    built.remove();
  }
  writeFileSync(resolve(options.out, 'index.html'), contactSheet(names, sizes, report.written));
  return report;
}

function contactSheet(names: string[], sizes: Size[], written: string[]): string {
  const shown = new Set(written);
  const rows = names
    .map((name) => {
      const cells = sizes
        .flatMap((size) =>
          SCHEMES.map((scheme) => {
            const file = `${name}-${size.width}-${scheme}.png`;
            if (!shown.has(file)) return '';
            return `<figure><a href="${file}"><img src="${file}" loading="lazy" alt="${file}"></a><figcaption>${size.width} ${scheme}</figcaption></figure>`;
          })
        )
        .join('');
      return cells ? `<section><h2>${name}</h2><div class="row">${cells}</div></section>` : '';
    })
    .filter((row) => row !== '')
    .join('\n');
  return `<!doctype html>
<meta charset="utf-8">
<title>Connect page screenshots</title>
<style>
body { font: 14px system-ui, sans-serif; margin: 1rem; }
.row { display: flex; flex-wrap: wrap; gap: 1rem; }
figure { margin: 0; width: 24rem; }
img { width: 100%; border: 1px solid #8884; }
</style>
${rows}
`;
}

function argument(flag: string): string | undefined {
  const at = process.argv.indexOf(flag);
  return at >= 0 ? process.argv[at + 1] : undefined;
}

if (require.main === module) {
  const sizes = argument('--sizes')
    ?.split(',')
    .map((text) => {
      const [width, height] = text.split('x').map(Number);
      return { width: width as number, height: height as number };
    });
  const routes = argument('--routes')?.split(',');
  captureScreenshots({
    out: resolve(argument('--out') ?? 'connect-screenshots'),
    ...(routes ? { routes } : {}),
    ...(sizes ? { sizes } : {}),
  }).then(
    (report) => {
      for (const failure of report.failed) {
        console.error(
          `${failure.name} at ${failure.size.width} in ${failure.scheme}: ${failure.message}`
        );
      }
      console.log(
        `wrote ${report.written.length} screenshots` +
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
