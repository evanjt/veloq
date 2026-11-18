#!/usr/bin/env tsx
// What drawing every route or every section on the connect map costs in the
// headless browser harness: the time from opening the page to the map's first
// idle frame with the list's lines loaded, and the time one re-tile and redraw
// takes afterwards. The lines come from the demo library unless a GeoJSON
// file is named, so a collection dumped from a larger library can be timed.
//
//   npx tsx scripts/measure-collection-draw.ts [--sections <file>] [--routes <file>] [--repeat 3]
//
// Headless Chromium draws through its software renderer, so the figures are a
// ceiling for a browser with a GPU, not what the athlete sees. Prints, asserts
// nothing.

import { readFileSync } from 'node:fs';

import { phoneScript } from '../src/__tests__/__shared__/connectPhoneScripts';
import {
  buildPage,
  findChromium,
  launchConnectBrowser,
  type ConnectPage,
} from '../src/__tests__/__shared__/headlessConnectPage';

type Marks = Record<string, number>;

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const repeat = Number(option('--repeat') ?? 3);

/** Wraps the renderer's constructor so the page's own map reports its marks, then opens `hash`. */
const HOOK = (hash: string) => `(() => {
  const Original = maplibregl.Map;
  const marks = (window.__marks = {});
  function Hooked(options) {
    const map = new Original(options);
    window.__map = map;
    marks.created = performance.now();
    map.on('load', () => { marks.load = performance.now(); });
    map.on('sourcedata', (event) => {
      if (event.dataType === 'source' && event.isSourceLoaded && event.sourceId === 'lines' && !marks.lines) {
        marks.lines = performance.now();
      }
    });
    map.on('idle', () => { if (marks.lines && !marks.idle) marks.idle = performance.now(); });
    return map;
  }
  Hooked.prototype = Original.prototype;
  Object.assign(Hooked, Original);
  maplibregl.Map = Hooked;
  marks.navigate = performance.now();
  location.hash = ${JSON.stringify(hash)};
})()`;

/** Nudges the zoom, which re-tiles the GeoJSON source, and times the frame to the next idle. */
const REDRAW = `new Promise((done) => {
  const map = window.__map;
  const at = performance.now();
  map.once('idle', () => done(performance.now() - at));
  map.setZoom(map.getZoom() + 0.3);
})`;

async function measure(
  page: ConnectPage,
  hash: string
): Promise<{ marks: Marks; redraws: number[] }> {
  await page.evaluate(HOOK(hash));
  const marks = await page.until<Marks>('window.__marks.idle ? window.__marks : null', 60_000);
  const redraws: number[] = [];
  for (let n = 0; n < repeat; n += 1) redraws.push(await page.evaluate<number>(REDRAW));
  return { marks, redraws };
}

function geoShape(text: string): string {
  const geo = JSON.parse(text) as { features: { geometry: { coordinates: unknown[] } }[] };
  const vertices = geo.features.reduce((n, f) => n + f.geometry.coordinates.length, 0);
  return `${geo.features.length} features, ${vertices} vertices, ${text.length} bytes`;
}

async function main() {
  const executable = findChromium();
  if (!executable) throw new Error('no chromium found; set CHROME_PATH');
  const script = await phoneScript('demo');
  const results = script.results as Record<string, { text: string }>;
  const sections = option('--sections');
  const routes = option('--routes');
  if (sections) results['geo.sections'] = { text: readFileSync(sections, 'utf8') };
  if (routes) results['geo.routeLines'] = { text: readFileSync(routes, 'utf8') };
  const built = buildPage();
  const browser = await launchConnectBrowser(executable, built.dir);
  try {
    for (const [hash, method] of [
      ['#/sections', 'geo.sections'],
      ['#/routes', 'geo.routeLines'],
    ] as const) {
      const page = await browser.open(script, undefined, { width: 1920, height: 1080 });
      try {
        await page.until(`document.querySelector('#feed-scroll, #library, main') !== null`, 30_000);
        const { marks, redraws } = await measure(page, hash);
        const ms = (a: string, b: string) => (marks[b] - marks[a]).toFixed(0);
        console.log(`${hash}  ${geoShape(results[method].text)}`);
        console.log(
          `  navigate→map created ${ms('navigate', 'created')} ms, →style load ${ms('navigate', 'load')} ms, ` +
            `→lines loaded ${ms('navigate', 'lines')} ms, →first idle ${ms('navigate', 'idle')} ms ` +
            `(lines loaded→idle ${ms('lines', 'idle')} ms)`
        );
        console.log(
          `  redraw after a zoom nudge: ${redraws.map((r) => r.toFixed(0)).join(', ')} ms`
        );
        const errors = page.errors();
        if (errors.length) console.log(`  page errors: ${errors.join(' | ')}`);
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
    built.remove();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
