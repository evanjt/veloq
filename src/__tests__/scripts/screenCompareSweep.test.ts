/**
 * Scenario: the screen compare tool exists, but the E2E sweep only uploads its
 * screenshots, so a branch that moves a theme token passes every job.
 *
 * Expected behaviour: each platform's E2E run captures the compare set and
 * holds it against the goldens, failing with diff images on a mismatch. A
 * dispatch input captures candidates instead, laid out as goldens, and writes
 * nothing into the tree: a golden lands only by a commit after sign-off.
 */
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
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
const SCRIPT = join(ROOT, 'scripts/screen-compare-ci.sh');
const THEMES = ['light', 'dark'];
const SCREENS = ['quay', 'ferry'];

const MASKS = {
  everyScreen: [{ name: 'status bar', x0: 0, y0: 0, x1: 1, y1: 0.05 }],
  screens: { quay: [], ferry: [{ name: 'buoy', x0: 0, y0: 0.6, x1: 1, y1: 0.8 }] },
};

/** A screen of one surface colour with a dark row of "text". */
function screen(surface = 255): Buffer {
  const png = new PNG({ width: 60, height: 120 });
  png.data.fill(surface);
  for (let y = 30; y < 33; y++) {
    for (let x = 5; x < 55; x++) png.data.fill(20, (y * 60 + x) * 4, (y * 60 + x) * 4 + 3);
  }
  return PNG.sync.write(png);
}

function write(file: string, bytes: Buffer | string) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}

/** A workspace holding the masks, optionally goldens, and the captures a flow wrote. */
function workspace({ goldens = true, captures = true, surface = 255 } = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'veloq-screen-compare-sweep-'));
  write(join(root, '.maestro/goldens/masks.json'), JSON.stringify(MASKS));
  for (const theme of THEMES) {
    for (const name of SCREENS) {
      if (goldens) write(join(root, '.maestro/goldens/android', theme, `${name}.png`), screen());
      if (captures) {
        const painted = theme === 'dark' && name === 'quay' ? surface : 255;
        write(join(root, 'screenshots/compare', theme, `${name}.png`), screen(painted));
      }
    }
  }
  return root;
}

function run(cwd: string, ...args: string[]) {
  return spawnSync('sh', [SCRIPT, ...args], { cwd, encoding: 'utf8' });
}

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name).slice(dir.length + 1))
    .sort();
}

const CANDIDATES = THEMES.flatMap((t) => SCREENS.map((s) => `android/${t}/${s}.png`)).sort();

describe('screen-compare-ci.sh', () => {
  it('passes captures that match the goldens and hands them on as candidates', () => {
    const root = workspace();
    const result = run(root, 'android', 'compare');

    expect(result.status).toBe(0);
    expect(files(join(root, 'screen-compare/candidates'))).toEqual(CANDIDATES);
    expect(files(join(root, 'screen-compare/diffs'))).toEqual([]);
  });

  it('fails a surface colour change and writes the diff image of that screen', () => {
    const root = workspace({ surface: 240 });
    const result = run(root, 'android', 'compare');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('android dark quay');
    expect(files(join(root, 'screen-compare/diffs'))).toEqual(['android/dark/quay.png']);
  });

  it('fails a compare with no goldens rather than recording them', () => {
    const root = workspace({ goldens: false });
    const result = run(root, 'android', 'compare');

    expect(result.status).toBe(1);
    expect(existsSync(join(root, '.maestro/goldens/android'))).toBe(false);
  });

  it('fails a compare whose capture wrote nothing', () => {
    const root = workspace({ captures: false });

    expect(run(root, 'android', 'compare').status).toBe(1);
  });

  it('captures candidates without comparing and leaves the goldens alone', () => {
    const root = workspace({ goldens: false, surface: 240 });
    const masks = readFileSync(join(root, '.maestro/goldens/masks.json'), 'utf8');
    const result = run(root, 'android', 'capture');

    expect(result.status).toBe(0);
    expect(files(join(root, 'screen-compare/candidates'))).toEqual(CANDIDATES);
    expect(files(join(root, '.maestro/goldens'))).toEqual(['masks.json']);
    expect(readFileSync(join(root, '.maestro/goldens/masks.json'), 'utf8')).toBe(masks);
  });

  it('fails a capture that has no captures to hand on', () => {
    const root = workspace({ captures: false });

    expect(run(root, 'android', 'capture').status).not.toBe(0);
  });

  it.each([
    ['windows', 'compare'],
    ['android', 'record'],
  ])('refuses platform %s with mode %s', (platform, mode) => {
    expect(run(workspace(), platform, mode).status).toBe(2);
  });
});

type Step = {
  name?: string;
  run?: string;
  uses?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, unknown>;
};
type Job = { needs?: string | string[]; steps?: Step[] };
type Workflow = {
  on: { workflow_dispatch: { inputs: Record<string, { type?: string; default?: unknown }> } };
  jobs: Record<string, Job>;
};

const sweep = yaml.load(readFileSync(join(ROOT, '.github/workflows/e2e.yml'), 'utf8')) as Workflow;

/** Every script a step hands a shell, the emulator runner's included. */
const scripts = (step: Step) => [step.run ?? '', String(step.with?.script ?? '')].join('\n');

function jobComparing(platform: string): [string, Job] {
  const found = Object.entries(sweep.jobs).filter(([, job]) =>
    (job.steps ?? []).some((s) => scripts(s).includes(`scripts/screen-compare-ci.sh ${platform}`))
  );
  expect(found).toHaveLength(1);
  return found[0];
}

describe('the E2E sweep', () => {
  it('takes a dispatch input that captures candidates, off by default', () => {
    const input = sweep.on.workflow_dispatch.inputs['capture-candidates'];

    expect(input).toEqual(expect.objectContaining({ type: 'boolean', default: false }));
  });

  it.each(['android', 'ios'])('captures and compares the %s screens', (platform) => {
    const [, job] = jobComparing(platform);
    const steps = job.steps ?? [];
    const all = steps.map(scripts).join('\n');

    expect(all).toContain(`scripts/capture-screen-compare-${platform}.sh`);
    const compare = steps.find((s) => scripts(s).includes('scripts/screen-compare-ci.sh'))!;
    expect(JSON.stringify(compare)).toContain('inputs.capture-candidates');

    const uploads = steps
      .filter((s) => String(s.uses).startsWith('actions/upload-artifact'))
      .map((s) => ({ path: String(s.with?.path), always: s.if === 'always()' }));
    expect(uploads).toEqual(
      expect.arrayContaining([
        { path: 'screen-compare/diffs/', always: true },
        { path: 'screen-compare/candidates/', always: true },
      ])
    );
  });

  it.each(['android', 'ios'])('fails the summary when the %s compare fails', (platform) => {
    const [id] = jobComparing(platform);
    const summary = sweep.jobs['e2e-summary'];

    expect(summary.needs).toContain(id);
    expect(JSON.stringify(summary.steps)).toContain(`needs.${id}.result`);
  });

  it('never writes a golden or the tree from a job', () => {
    const all = Object.values(sweep.jobs)
      .flatMap((job) => job.steps ?? [])
      .map(scripts)
      .join('\n');

    expect(all).not.toMatch(/git (commit|push)|\.maestro\/goldens/);
  });
});
