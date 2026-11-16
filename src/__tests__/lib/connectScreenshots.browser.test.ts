/**
 * Scenario: the screenshot tool builds the connect page, serves it a scripted
 * phone holding the demo library and captures routes in each colour scheme.
 * A capture that never draws is reported, the others are still written, and
 * the run exits non-zero.
 *
 * Expected behaviour: one PNG per route, size and scheme, of the size asked,
 * that is not one flat colour, and an index that names each of them. The light
 * and dark captures of one route differ. A failed capture is named in the
 * report and fails the exit status.
 *
 * Runs with `npm run test:map-pages`, which needs a Chromium.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

import { ROUTES, captureScreenshots, exitStatus } from '../../../scripts/connect-screenshots';
import { phoneScript } from '../__shared__/connectPhoneScripts';
import { buildPage, findChromium, launchConnectBrowser } from '../__shared__/headlessConnectPage';

const chromium = findChromium();
const describeWithChromium = chromium ? describe : describe.skip;

/** The size and the distinct pixel values of a PNG of 8-bit RGB or RGBA rows. */
function inspect(file: string) {
  const bytes = readFileSync(file);
  expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const colourType = bytes[25];
  const channels = colourType === 6 ? 4 : 3;
  const data: Buffer[] = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at);
    if (bytes.subarray(at + 4, at + 8).toString('ascii') === 'IDAT') {
      data.push(bytes.subarray(at + 8, at + 8 + length));
    }
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const seen = new Set<string>();
  const stride = 1 + width * channels;
  for (let row = 0; row < height; row += 7) {
    seen.add(raw.subarray(row * stride + 1, row * stride + 1 + width * channels).toString('hex'));
  }
  return { width, height, rows: seen.size, raw };
}

describeWithChromium('the connect screenshot tool', () => {
  let out: string;
  beforeEach(() => {
    out = mkdtempSync(join(tmpdir(), 'connect-shots-'));
  });
  afterEach(() => rmSync(out, { recursive: true, force: true }));

  it('writes a non-blank PNG of each route, size and scheme and an index naming them', async () => {
    const report = await captureScreenshots({
      out,
      routes: ['feed', 'routes', 'pairing'],
      sizes: [{ width: 1280, height: 800 }],
      chromium: chromium as string,
    });
    expect(report.failed).toEqual([]);
    expect(exitStatus(report)).toBe(0);
    const files = readdirSync(out).sort();
    expect(files).toEqual([
      'feed-1280-dark.png',
      'feed-1280-light.png',
      'index.html',
      'pairing-1280-dark.png',
      'pairing-1280-light.png',
      'routes-1280-dark.png',
      'routes-1280-light.png',
    ]);
    for (const name of ['feed', 'routes', 'pairing']) {
      const light = inspect(join(out, `${name}-1280-light.png`));
      const dark = inspect(join(out, `${name}-1280-dark.png`));
      for (const shot of [light, dark]) {
        expect([shot.width, shot.height]).toEqual([1280, 800]);
        expect(shot.rows).toBeGreaterThan(20);
      }
      expect(light.raw.equals(dark.raw)).toBe(false);
    }
    const index = readFileSync(join(out, 'index.html'), 'utf8');
    expect(index).toContain('feed-1280-light.png');
    expect(index).toContain('pairing-1280-dark.png');
  }, 180_000);

  it('reports a capture that never draws, still writes the others, and exits non-zero', async () => {
    const report = await captureScreenshots({
      out,
      routes: ['absent', 'feed'],
      captures: {
        absent: { ready: `document.querySelector('#no-such-screen') !== null` },
        feed: ROUTES.feed as NonNullable<(typeof ROUTES)['feed']>,
      },
      sizes: [{ width: 1280, height: 800 }],
      timeoutMs: 8_000,
      chromium: chromium as string,
    });
    expect(report.failed.map((failure) => `${failure.name} ${failure.scheme}`)).toEqual([
      'absent light',
      'absent dark',
    ]);
    expect(report.written).toEqual(['feed-1280-light.png', 'feed-1280-dark.png']);
    expect(readdirSync(out).sort()).toEqual([
      'feed-1280-dark.png',
      'feed-1280-light.png',
      'index.html',
    ]);
    expect(exitStatus(report)).toBe(1);
  }, 120_000);

  it('writes a PNG of each detail page the demo library answers, in each scheme', async () => {
    const pages = ['route', 'section', 'strength', 'recordings', 'recording', 'workouts', 'live'];
    await captureScreenshots({
      out,
      routes: pages,
      sizes: [{ width: 1280, height: 800 }],
      chromium: chromium as string,
    });
    const expected = pages.flatMap((page) => [`${page}-1280-dark.png`, `${page}-1280-light.png`]);
    const files = readdirSync(out).sort();
    expect(files).toEqual([...expected, 'index.html'].sort());
    for (const page of pages) {
      const light = inspect(join(out, `${page}-1280-light.png`));
      const dark = inspect(join(out, `${page}-1280-dark.png`));
      for (const shot of [light, dark]) {
        expect([shot.width, shot.height]).toEqual([1280, 800]);
        expect(shot.rows).toBeGreaterThan(20);
      }
      expect(light.raw.equals(dark.raw)).toBe(false);
    }
  }, 300_000);

  it('refuses a route it does not know', async () => {
    await expect(
      captureScreenshots({ out, routes: ['nowhere'], chromium: chromium as string })
    ).rejects.toThrow(/nowhere/);
  });

  it('keeps a phone whose every read fails connected while each panel shows its error', async () => {
    const built = buildPage();
    const browser = await launchConnectBrowser(chromium as string, built.dir);
    try {
      const page = await browser.open(await phoneScript('failing'), 'en', {
        width: 1280,
        height: 800,
      });
      await page.until(`document.querySelector('#status[data-state="connected"]') !== null`);
      await page.evaluate(`(() => {
        window.__states = [document.querySelector('#status').dataset.state];
        new MutationObserver(() => {
          const state = document.querySelector('#status')?.dataset.state;
          if (state !== window.__states[window.__states.length - 1]) window.__states.push(state);
        }).observe(document.body, { subtree: true, attributes: true, childList: true });
        location.hash = '#/feed';
      })()`);
      await page.until(`document.querySelector('[data-read-error="failed"]') !== null`);
      await new Promise((done) => setTimeout(done, 4_000));
      expect(await page.evaluate<string[]>('window.__states')).toEqual(['connected']);
      await page.close();
    } finally {
      await browser.close();
      built.remove();
    }
  }, 120_000);
});
