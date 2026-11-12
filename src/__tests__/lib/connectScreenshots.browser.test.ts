/**
 * Scenario: the screenshot tool builds the connect page, serves it a scripted
 * phone holding the demo library and captures a route in each colour scheme.
 *
 * Expected behaviour: one PNG per size and scheme, of the size asked, that is
 * not one flat colour, and an index that names each of them. The light and dark
 * captures of one route differ.
 *
 * Runs with `npm run test:map-pages`, which needs a Chromium.
 */

import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';

import { captureScreenshots } from '../../../scripts/connect-screenshots';
import { findChromium } from '../__shared__/headlessConnectPage';

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

  it('writes a non-blank PNG of each size in each scheme and an index naming them', async () => {
    await captureScreenshots({
      out,
      routes: ['feed'],
      sizes: [{ width: 1280, height: 800 }],
      chromium: chromium as string,
    });
    const files = readdirSync(out).sort();
    expect(files).toEqual(['feed-1280-dark.png', 'feed-1280-light.png', 'index.html']);
    const light = inspect(join(out, 'feed-1280-light.png'));
    const dark = inspect(join(out, 'feed-1280-dark.png'));
    for (const shot of [light, dark]) {
      expect([shot.width, shot.height]).toEqual([1280, 800]);
      expect(shot.rows).toBeGreaterThan(20);
    }
    expect(light.raw.equals(dark.raw)).toBe(false);
    const index = readFileSync(join(out, 'index.html'), 'utf8');
    expect(index).toContain('feed-1280-light.png');
    expect(index).toContain('feed-1280-dark.png');
  }, 120_000);

  it('refuses a route it does not know', async () => {
    await expect(
      captureScreenshots({ out, routes: ['nowhere'], chromium: chromium as string })
    ).rejects.toThrow(/nowhere/);
  });
});
