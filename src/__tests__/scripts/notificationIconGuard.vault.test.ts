/**
 * Scenario: Android draws a notification's small icon from its alpha channel
 * and tints it, so a full-colour icon on an opaque ground shows as a blank
 * square in the status bar and the shade.
 *
 * Expected behaviour: the guard passes the icon the repository's `app.json`
 * gives the `expo-notifications` plugin, and refuses the launcher artwork, a
 * coloured glyph, a white square and an entry that names no icon.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

import { gitFreeEnv } from '../__shared__/gitFixture';

const REPO = join(__dirname, '../../..');
const SCRIPT = join(REPO, 'scripts/lint-notification-icon.mjs');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function run(args: string[]): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, ...args], {
      cwd: REPO,
      encoding: 'utf8',
      env: gitFreeEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

function chunk(type: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** An 8-bit RGBA PNG whose pixel at (x, y) is `pixel(x, y)`. */
function png(size: number, pixel: (x: number, y: number) => number[]): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const rows: number[] = [];
  for (let y = 0; y < size; y++) {
    rows.push(0);
    for (let x = 0; x < size; x++) rows.push(...pixel(x, y));
  }
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A root holding an `app.json` with the plugin entry given and the files given. */
function fixture(entry: unknown, files: Record<string, Buffer | string> = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'notification-icon-'));
  roots.push(root);
  writeFileSync(join(root, 'app.json'), JSON.stringify({ expo: { plugins: [entry] } }));
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    if (typeof contents === 'string') copyFileSync(contents, join(root, path));
    else writeFileSync(join(root, path), contents);
  }
  return root;
}

const inCentre = (x: number, y: number) => x >= 8 && x < 24 && y >= 8 && y < 24;

/** The plugin entry the repository's `app.json` holds, with the icon it names. */
function repositoryEntry(): [string, { icon: string }] {
  const app = JSON.parse(readFileSync(join(REPO, 'app.json'), 'utf8')) as {
    expo: { plugins: unknown[] };
  };
  const entry = app.expo.plugins.find(
    (p): p is [string, { icon: string }] => Array.isArray(p) && p[0] === 'expo-notifications'
  );
  if (!entry) throw new Error('app.json has no expo-notifications entry');
  return entry;
}

it('passes the icon the repository gives the plugin', () => {
  const entry = repositoryEntry();
  const root = fixture(entry, { [entry[1].icon]: join(REPO, entry[1].icon) });

  expect(run(['--root', root])).toEqual({ status: 0, output: '' });
});

it('refuses the opaque launcher artwork', () => {
  const root = fixture(['expo-notifications', { icon: './src/assets/launcher.png' }], {
    'src/assets/launcher.png': join(REPO, 'src/assets/icon.png'),
  });

  const { status, output } = run(['--root', root]);

  expect(status).toBe(1);
  expect(output).toContain('solid square');
  expect(output).toContain('fully transparent');
  expect(output).toContain('not white');
});

it('passes a white glyph on transparency', () => {
  const root = fixture(['expo-notifications', { icon: './glyph.png' }], {
    'glyph.png': png(32, (x, y) => (inCentre(x, y) ? [255, 255, 255, 255] : [0, 0, 0, 0])),
  });

  expect(run(['--root', root])).toEqual({ status: 0, output: '' });
});

it('refuses a coloured glyph on transparency', () => {
  const root = fixture(['expo-notifications', { icon: './glyph.png' }], {
    'glyph.png': png(32, (x, y) => (inCentre(x, y) ? [13, 148, 136, 255] : [0, 0, 0, 0])),
  });

  const { status, output } = run(['--root', root]);

  expect(status).toBe(1);
  expect(output).toContain('256 opaque pixels are not white');
});

it('refuses a white square, which tints to a blank square', () => {
  const root = fixture(['expo-notifications', { icon: './glyph.png' }], {
    'glyph.png': png(32, () => [255, 255, 255, 255]),
  });

  const { status, output } = run(['--root', root]);

  expect(status).toBe(1);
  expect(output).toContain('0.0 % of its pixels are fully transparent');
});

it('refuses a ground at exactly half transparent only below the line', () => {
  const half = (x: number) => (x < 16 ? [255, 255, 255, 255] : [0, 0, 0, 0]);
  const atLine = fixture(['expo-notifications', { icon: './glyph.png' }], {
    'glyph.png': png(32, half),
  });
  const underLine = fixture(['expo-notifications', { icon: './glyph.png' }], {
    'glyph.png': png(32, (x, y) => (x === 16 && y === 0 ? [255, 255, 255, 255] : half(x))),
  });

  expect(run(['--root', atLine]).status).toBe(0);
  expect(run(['--root', underLine]).status).toBe(1);
});

it('refuses a plugin entry that names no icon', () => {
  const { status, output } = run(['--root', fixture('expo-notifications')]);

  expect(status).toBe(1);
  expect(output).toContain('names no icon');
});

it('refuses an icon the tree does not hold', () => {
  const root = fixture(['expo-notifications', { icon: './missing.png' }]);

  const { status, output } = run(['--root', root]);

  expect(status).toBe(1);
  expect(output).toContain('missing.png, is not in the tree');
});
