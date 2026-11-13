/**
 * Scenario: a theme token, a component library bump or an OS release moves a
 * radius, a surface colour or a line height, and every Jest suite and guard
 * still passes, because nothing compares what a screen looks like.
 *
 * Expected behaviour: the compare script reads a golden and a candidate per
 * platform, theme and screen, ignores the masked rectangles, and fails when
 * more than 0.1% of the unmasked pixels differ, naming the screen and writing
 * a diff image. A missing golden is a failure, never a recording.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

interface Png {
  width: number;
  height: number;
  data: Buffer;
}
const { PNG } = require('pngjs') as {
  PNG: { new (size: { width: number; height: number }): Png; sync: { write(png: Png): Buffer } };
};
const yaml = require('js-yaml') as { load: (source: string) => unknown };

const ROOT = resolve(__dirname, '../../..');
const SCRIPT = join(ROOT, 'scripts/screenshot-compare.mjs');
const WIDTH = 100;
const HEIGHT = 200;
const THEMES = ['light', 'dark'];

type Rect = { name: string; x0: number; y0: number; x1: number; y1: number; platform?: string };

const MASKS: { everyScreen: Rect[]; screens: Record<string, Rect[]> } = {
  everyScreen: [{ name: 'status bar', x0: 0, y0: 0, x1: 1, y1: 0.05 }],
  screens: {
    harbour: [{ name: 'tide gauge', x0: 0, y0: 0.6, x1: 1, y1: 0.8 }],
    lighthouse: [{ name: 'lamp', x0: 0, y0: 0.6, x1: 1, y1: 0.8, platform: 'ios' }],
  },
};

type Paint = (png: Png) => void;

function fill(png: Png, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * png.width + x) * 4;
      png.data[i] = 20;
      png.data[i + 1] = 20;
      png.data[i + 2] = 20;
    }
  }
}

/** A white screen with a status bar and two dark rows of "text". */
function screen(paint: Paint = () => {}, width = WIDTH, height = HEIGHT): Buffer {
  const png = new PNG({ width, height });
  png.data.fill(255);
  fill(png, 0, 0, width, 6);
  fill(png, 10, 40, 90, 43);
  fill(png, 10, 100, 90, 103);
  paint(png);
  return PNG.sync.write(png);
}

interface Fixture {
  goldens: string;
  candidates: string;
  diffs: string;
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'veloq-screenshot-compare-'));
  const f = {
    goldens: join(root, 'goldens'),
    candidates: join(root, 'candidates'),
    diffs: join(root, 'diffs'),
  };
  mkdirSync(f.goldens, { recursive: true });
  writeFileSync(join(f.goldens, 'masks.json'), JSON.stringify(MASKS, null, 2));
  for (const platform of ['android', 'ios']) {
    for (const theme of THEMES) {
      for (const name of Object.keys(MASKS.screens)) {
        write(join(f.goldens, platform, theme, `${name}.png`), screen());
      }
    }
  }
  for (const theme of THEMES) {
    for (const name of Object.keys(MASKS.screens)) {
      write(join(f.candidates, theme, `${name}.png`), screen());
    }
  }
  return f;
}

function write(file: string, bytes: Buffer) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}

function compare(f: Fixture, platform = 'android') {
  const run = spawnSync(
    'node',
    [
      SCRIPT,
      '--platform',
      platform,
      '--goldens',
      f.goldens,
      '--candidates',
      f.candidates,
      '--diffs',
      f.diffs,
    ],
    { encoding: 'utf8' }
  );
  return { status: run.status, output: `${run.stdout}${run.stderr}` };
}

const fixtures: string[] = [];
function tracked(): Fixture {
  const f = fixture();
  fixtures.push(dirname(f.goldens));
  return f;
}
afterAll(() => fixtures.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

describe('the screenshot compare script', () => {
  it('passes identical captures', () => {
    const f = tracked();
    const run = compare(f);
    expect(run.output).toContain('harbour');
    expect(run.status).toBe(0);
  });

  it('passes a change inside a mask', () => {
    const f = tracked();
    write(
      join(f.candidates, 'dark', 'harbour.png'),
      screen((png) => fill(png, 0, 130, WIDTH, 150))
    );
    write(
      join(f.candidates, 'light', 'lighthouse.png'),
      screen((png) => fill(png, 0, 0, WIDTH, 10))
    );
    expect(compare(f).status).toBe(0);
  });

  it('passes a speck below the tolerance', () => {
    const f = tracked();
    write(
      join(f.candidates, 'light', 'harbour.png'),
      screen((png) => fill(png, 50, 70, 60, 71))
    );
    expect(compare(f).status).toBe(0);
  });

  it('fails a text row shifted down by one pixel, names the screen and writes a diff', () => {
    const f = tracked();
    write(
      join(f.candidates, 'dark', 'lighthouse.png'),
      screen((png) => {
        png.data.fill(255, 40 * WIDTH * 4, 43 * WIDTH * 4);
        fill(png, 10, 41, 90, 44);
      })
    );
    const run = compare(f);
    expect(run.status).not.toBe(0);
    expect(run.output).toMatch(/android dark lighthouse/);
    expect(run.output).not.toMatch(/android light lighthouse: [\d.]+% of unmasked/);
    expect(existsSync(join(f.diffs, 'android', 'dark', 'lighthouse.png'))).toBe(true);
  });

  it('applies a mask scoped to one platform on that platform only', () => {
    const f = tracked();
    write(
      join(f.candidates, 'light', 'lighthouse.png'),
      screen((png) => fill(png, 0, 130, WIDTH, 150))
    );
    expect(compare(f, 'ios').status).toBe(0);
    const run = compare(f, 'android');
    expect(run.status).not.toBe(0);
    expect(run.output).toMatch(/android light lighthouse/);
  });

  it('fails a size mismatch', () => {
    const f = tracked();
    write(join(f.candidates, 'light', 'harbour.png'), screen(undefined, WIDTH, HEIGHT + 2));
    const run = compare(f);
    expect(run.status).not.toBe(0);
    expect(run.output).toMatch(/android light harbour/);
    expect(run.output).toMatch(/100x202/);
  });

  it('fails a missing golden and records none', () => {
    const f = tracked();
    const golden = join(f.goldens, 'android', 'dark', 'harbour.png');
    rmSync(golden);
    const run = compare(f);
    expect(run.status).not.toBe(0);
    expect(run.output).toMatch(/android dark harbour/);
    expect(existsSync(golden)).toBe(false);
  });

  it('fails a missing candidate', () => {
    const f = tracked();
    rmSync(join(f.candidates, 'light', 'lighthouse.png'));
    const run = compare(f);
    expect(run.status).not.toBe(0);
    expect(run.output).toMatch(/android light lighthouse/);
  });

  it('refuses an unknown platform', () => {
    const f = tracked();
    expect(compare(f, 'web').status).not.toBe(0);
  });
});

describe('the committed masks and the capture flow', () => {
  const masks = JSON.parse(
    readFileSync(join(ROOT, '.maestro/goldens/masks.json'), 'utf8')
  ) as typeof MASKS;
  const rects = [...masks.everyScreen, ...Object.values(masks.screens).flat()];

  it('holds the seven screens', () => {
    expect(Object.keys(masks.screens)).toHaveLength(7);
  });

  it.each(rects.map((r) => [r.name, r] as const))('%s is a rectangle inside the image', (_n, r) => {
    expect(0 <= r.x0 && r.x0 < r.x1 && r.x1 <= 1).toBe(true);
    expect(0 <= r.y0 && r.y0 < r.y1 && r.y1 <= 1).toBe(true);
    expect([undefined, 'android', 'ios']).toContain(r.platform);
  });

  it('captures every screen the masks name, in both themes, and nothing else', () => {
    type Step = Record<string, unknown>;
    const steps = (file: string) =>
      (
        readFileSync(join(ROOT, '.maestro', file), 'utf8')
          .split(/^---$/m)
          .slice(1)
          .map((doc) => yaml.load(doc))[0] as Step[]
      ).filter((s) => s && typeof s === 'object');

    const top = steps('screen-compare.yaml');
    const themes = top
      .map((s) => s.runFlow as { file?: string; env?: { THEME?: string } } | undefined)
      .filter((r) => r?.file === 'helpers/capture-compare-screens.yaml')
      .map((r) => r?.env?.THEME);
    expect(themes.sort()).toEqual(['dark', 'light']);

    const captured = steps('helpers/capture-compare-screens.yaml')
      .map((s) => s.takeScreenshot)
      .filter((p): p is string => typeof p === 'string');
    expect(captured.every((p) => p.startsWith('screenshots/compare/${THEME}/'))).toBe(true);
    expect(captured.map((p) => p.split('/').pop()).sort()).toEqual(
      Object.keys(masks.screens).sort()
    );
  });
});
