#!/usr/bin/env tsx
// Renders every connect page at two window sizes in both colour schemes, from a
// scripted phone holding the demo library, and writes the PNGs and a contact
// sheet. The page is built the way the deploy builds it and runs in the
// browser harness the page's own tests use, so nothing here reaches a network.
//
// Usage: npm run connect:screenshots [-- --out <dir>] [--routes feed,map] [--sizes 1280x800]
//
// `--out` defaults to `connect-screenshots/`, which is git-ignored.

import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { normaliseFingerprint, proof } from '../web/connect/link';
import { SHOWN_ACTIVITY, demoScript } from '../src/__tests__/__shared__/connectDemoLibrary';
import {
  buildPage,
  findChromium,
  launchConnectBrowser,
  type ConnectPage,
  type Script,
} from '../src/__tests__/__shared__/headlessConnectPage';

export interface Size {
  width: number;
  height: number;
}

export const SIZES: Size[] = [
  { width: 1280, height: 800 },
  { width: 1600, height: 1000 },
];

const SCHEMES = ['light', 'dark'] as const;

type Capture = {
  /** The hash the page is sent to; absent leaves it where the connection puts it. */
  hash?: string;
  /** A phone that never answers, or answers with a failure, instead of the demo library. */
  phone?: 'unpaired' | 'failing';
  /** An expression true once the screen has drawn its content. */
  ready: string;
  /** What is done once it has, and an expression true when that has taken effect. */
  then?: { do: string; until: string };
};

const has = (selector: string) => `document.querySelector(${JSON.stringify(selector)}) !== null`;

/** Every page, by the name its files carry. */
export const ROUTES: Record<string, Capture> = {
  feed: { hash: '#/feed', ready: `document.querySelectorAll('#feed tbody tr').length > 5` },
  activity: {
    hash: `#/activity/${SHOWN_ACTIVITY}`,
    ready: `document.querySelectorAll('dt').length > 3`,
  },
  fitness: { hash: '#/fitness', ready: has('#months tbody tr') },
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
  routes: { hash: '#/routes', ready: has('main a, main li') },
  sections: { hash: '#/sections', ready: has('main a, main li') },
  settings: {
    hash: '#/settings',
    ready: `document.querySelector('#settings-profile dd') !== null`,
  },
  pairing: { phone: 'unpaired', ready: `document.querySelector('h2') !== null` },
  errors: { phone: 'failing', hash: '#/feed', ready: `document.body.innerText.length > 40` },
};

const BROWSER_FINGERPRINT = normaliseFingerprint('sha-256', 'AA:11:22:33');
const PHONE_FINGERPRINT = normaliseFingerprint('sha-256', 'BB:44:55:66');
/** The page draws its secret from 32 bytes of 2 under the harness's fixed random bytes. */
const SECRET = new Uint8Array(32).fill(2);

async function scriptFor(kind: Capture['phone']): Promise<Script> {
  const script = demoScript({
    browserFingerprint: BROWSER_FINGERPRINT,
    phoneFingerprint: PHONE_FINGERPRINT,
    phoneProof: await proof(SECRET, 'phone', BROWSER_FINGERPRINT, PHONE_FINGERPRINT),
  });
  if (kind === 'unpaired') return { ...script, invite: null, linked: null };
  if (kind === 'failing') {
    // The phone lists its methods and answers none of them.
    return { ...script, results: {} };
  }
  return script;
}

const settle = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function shoot(page: ConnectPage, capture: Capture): Promise<Buffer> {
  if (capture.phone !== 'unpaired') {
    await page.until(`document.getElementById('status')?.textContent === 'Connected'`, 30_000);
    if (capture.hash) await page.evaluate(`location.hash = ${JSON.stringify(capture.hash)}`);
  }
  await page.until(capture.ready, 30_000);
  if (capture.then) {
    await page.evaluate(capture.then.do);
    await page.until(capture.then.until, 30_000);
    await settle(2_000);
  }
  await settle(1_200);
  return page.screenshot();
}

export interface Options {
  out: string;
  routes?: string[];
  sizes?: Size[];
  chromium?: string;
}

/** Writes `<route>-<width>-<scheme>.png` for each route, size and scheme, and `index.html`. */
export async function captureScreenshots(options: Options): Promise<string[]> {
  const names = options.routes ?? Object.keys(ROUTES);
  const unknown = names.filter((name) => !(name in ROUTES));
  if (unknown.length > 0) {
    throw new Error(
      `no such route: ${unknown.join(', ')}; the routes are ${Object.keys(ROUTES).join(', ')}`
    );
  }
  const executable = options.chromium ?? findChromium();
  if (!executable) throw new Error('no Chromium found; set CHROME_PATH');
  const sizes = options.sizes ?? SIZES;

  rmSync(options.out, { recursive: true, force: true });
  mkdirSync(options.out, { recursive: true });
  const built = buildPage();
  const browser = await launchConnectBrowser(executable, built.dir);
  const written: string[] = [];
  try {
    for (const name of names) {
      const capture = ROUTES[name] as Capture;
      const script = await scriptFor(capture.phone);
      for (const size of sizes) {
        for (const scheme of SCHEMES) {
          const page = await browser.open(script, 'en', { ...size, scheme });
          try {
            const png = await shoot(page, capture);
            const file = `${name}-${size.width}-${scheme}.png`;
            writeFileSync(resolve(options.out, file), png);
            written.push(file);
          } catch (error) {
            throw new Error(
              `${name} at ${size.width} in ${scheme}: ${(error as Error).message}\n${page.errors().join('\n')}`
            );
          } finally {
            await page.close();
          }
        }
      }
    }
  } finally {
    await browser.close();
    built.remove();
  }
  writeFileSync(resolve(options.out, 'index.html'), contactSheet(names, sizes));
  return written;
}

function contactSheet(names: string[], sizes: Size[]): string {
  const rows = names
    .map((name) => {
      const cells = sizes
        .flatMap((size) =>
          SCHEMES.map((scheme) => {
            const file = `${name}-${size.width}-${scheme}.png`;
            return `<figure><a href="${file}"><img src="${file}" loading="lazy" alt="${file}"></a><figcaption>${size.width} ${scheme}</figcaption></figure>`;
          })
        )
        .join('');
      return `<section><h2>${name}</h2><div class="row">${cells}</div></section>`;
    })
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
    (files) => console.log(`wrote ${files.length} screenshots`),
    (error) => {
      console.error(String(error.message ?? error));
      process.exit(1);
    }
  );
}
