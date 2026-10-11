/**
 * Scenario: the app icon was drawn with rounded corners baked into the artwork,
 * so iOS flattened the transparent corners onto white and its own corner mask
 * showed white where the two curves part. The config also carried no Android
 * monochrome layer and no iOS dark or tinted variant, so themed and tinted
 * Home Screens fell back to the full-colour tile.
 *
 * Expected behaviour: the guard passes a complete icon set and refuses an
 * icon with any transparent pixel, an `ios.icon` without light, dark
 * and tinted images, a tinted image that is not opaque grayscale, and a
 * monochrome layer that is missing, more than one colour, or a solid tile.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

const SCRIPT = join(__dirname, '../../../scripts/check-app-icons.mjs');

type Rgba = [number, number, number, number];

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** An 8-bit RGBA PNG whose pixel at (x, y) is `pixel(x, y)`. */
function png(size: number, pixel: (x: number, y: number) => Rgba): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    const row = y * (size * 4 + 1);
    for (let x = 0; x < size; x += 1) raw.set(pixel(x, y), row + 1 + x * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const SIZE = 1024;
const inMark = (x: number, y: number) => x > 400 && x < 600 && y > 400 && y < 600;

const tile = () => png(SIZE, () => [91, 155, 213, 255]);
const roundedTile = () =>
  png(SIZE, (x, y) => {
    const r = 192;
    const cx = Math.min(Math.max(x, r), SIZE - 1 - r);
    const cy = Math.min(Math.max(y, r), SIZE - 1 - r);
    return (x - cx) ** 2 + (y - cy) ** 2 > r * r ? [0, 0, 0, 0] : [91, 155, 213, 255];
  });
const markOnClear = (colour: Rgba) => png(SIZE, (x, y) => (inMark(x, y) ? colour : [0, 0, 0, 0]));
const markOnBlack = () =>
  png(SIZE, (x, y) => (inMark(x, y) ? [255, 255, 255, 255] : [0, 0, 0, 255]));

/** The images a complete icon set names, by path. */
function completeImages(): Record<string, Buffer> {
  return {
    'art/icon.png': tile(),
    'art/icon-dark.png': markOnClear([255, 200, 0, 255]),
    'art/icon-tinted.png': markOnBlack(),
    'art/foreground.png': markOnClear([255, 200, 0, 255]),
    'art/monochrome.png': markOnClear([255, 255, 255, 255]),
  };
}

function completeConfig() {
  return {
    expo: {
      icon: './art/icon.png',
      ios: {
        icon: {
          light: './art/icon.png',
          dark: './art/icon-dark.png',
          tinted: './art/icon-tinted.png',
        },
      },
      android: {
        adaptiveIcon: {
          foregroundImage: './art/foreground.png',
          monochromeImage: './art/monochrome.png',
          backgroundColor: '#123456',
        },
      },
    },
  };
}

function runOn(
  config: unknown,
  images: Record<string, Buffer>
): { status: number; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'app-icons-'));
  roots.push(root);
  writeFileSync(join(root, 'app.json'), JSON.stringify(config));
  for (const [path, bytes] of Object.entries(images)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), bytes);
  }
  try {
    const output = execFileSync('node', [SCRIPT, '--root', root], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

it('passes a complete icon set', () => {
  expect(runOn(completeConfig(), completeImages()).status).toBe(0);
});

it('refuses a rounded icon, a string ios.icon and a missing monochrome layer together', () => {
  const config = {
    expo: {
      icon: './art/icon.png',
      android: { adaptiveIcon: { foregroundImage: './art/foreground.png' } },
    },
  };
  const { status, output } = runOn(config, {
    'art/icon.png': roundedTile(),
    'art/foreground.png': markOnClear([255, 200, 0, 255]),
  });

  expect(status).toBe(1);
  expect(output).toMatch(/icon: art\/icon\.png has \d+ pixels? below full opacity/);
  expect(output).toContain('ios.icon');
  expect(output).toContain('monochromeImage');
});

it('refuses a light icon with a single transparent pixel', () => {
  const images = completeImages();
  images['art/icon.png'] = png(SIZE, (x, y) =>
    x === 0 && y === 0 ? [91, 155, 213, 254] : [91, 155, 213, 255]
  );

  const { status, output } = runOn(completeConfig(), images);

  expect(status).toBe(1);
  expect(output).toContain('art/icon.png has 1 pixel below full opacity');
});

it('refuses an ios.icon that names its light image alone', () => {
  const config = completeConfig();
  config.expo.ios.icon = { light: './art/icon.png' } as typeof config.expo.ios.icon;

  const { status, output } = runOn(config, completeImages());

  expect(status).toBe(1);
  expect(output).toContain('ios.icon.dark');
  expect(output).toContain('ios.icon.tinted');
});

it('refuses an ios.icon naming a file that does not exist', () => {
  const images = completeImages();
  delete images['art/icon-dark.png'];

  const { status, output } = runOn(completeConfig(), images);

  expect(status).toBe(1);
  expect(output).toContain('art/icon-dark.png');
});

it('refuses an iOS image that is not 1024 square', () => {
  const images = completeImages();
  images['art/icon-dark.png'] = png(512, () => [0, 0, 0, 0]);

  const { status, output } = runOn(completeConfig(), images);

  expect(status).toBe(1);
  expect(output).toContain('art/icon-dark.png is 512x512');
});

it('refuses a tinted image on a transparent ground, which the build flattens onto white', () => {
  const images = completeImages();
  images['art/icon-tinted.png'] = markOnClear([255, 255, 255, 255]);

  const { status, output } = runOn(completeConfig(), images);

  expect(status).toBe(1);
  expect(output).toContain('art/icon-tinted.png');
  expect(output).toContain('below full opacity');
});

it('refuses a tinted image carrying colour', () => {
  const images = completeImages();
  images['art/icon-tinted.png'] = png(SIZE, (x, y) =>
    inMark(x, y) ? [255, 200, 0, 255] : [0, 0, 0, 255]
  );

  const { status, output } = runOn(completeConfig(), images);

  expect(status).toBe(1);
  expect(output).toContain('art/icon-tinted.png has');
  expect(output).toContain('not grayscale');
});

it('refuses a monochrome layer drawn in two colours', () => {
  const images = completeImages();
  images['art/monochrome.png'] = png(SIZE, (x, y) => {
    if (!inMark(x, y)) return [0, 0, 0, 0];
    return x < 500 ? [255, 255, 255, 255] : [255, 200, 0, 255];
  });

  const { status, output } = runOn(completeConfig(), images);

  expect(status).toBe(1);
  expect(output).toContain('art/monochrome.png');
  expect(output).toContain('colours');
});

it('refuses a monochrome layer that is a solid tile', () => {
  const images = completeImages();
  images['art/monochrome.png'] = png(SIZE, () => [255, 255, 255, 255]);

  const { status, output } = runOn(completeConfig(), images);

  expect(status).toBe(1);
  expect(output).toContain('art/monochrome.png');
  expect(output).toContain('transparent');
});

it('refuses a monochrome layer with no opaque pixel', () => {
  const images = completeImages();
  images['art/monochrome.png'] = png(SIZE, () => [0, 0, 0, 0]);

  const { status, output } = runOn(completeConfig(), images);

  expect(status).toBe(1);
  expect(output).toContain('art/monochrome.png has no opaque pixel');
});
