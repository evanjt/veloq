/**
 * Scenario: the gate ran its flows serially on one emulator. Splitting them
 * across emulators is only sound when every flow the tags select runs on
 * exactly one of them.
 *
 * Expected behaviour: for any shard count, the shards partition the selected
 * flows, a flow outside the tags runs nowhere, and the split does not depend
 * on the order the directory lists files in.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');
const SELECT_PATH = path.join(REPO_ROOT, '.maestro/shard-flows.mjs');

type Select = (options: {
  dir: string;
  include: string[];
  exclude: string[];
  index: number;
  count: number;
}) => string[];

// The selector is an ES module and Jest runs CommonJS, so it runs as the gate
// runs it, as a command.
const loadSelect = async (): Promise<Select> => (options) => {
  const result = spawnSync(
    'node',
    [
      SELECT_PATH,
      `${options.index}/${options.count}`,
      options.include.join(','),
      options.exclude.join(','),
      options.dir,
    ],
    { encoding: 'utf8' }
  );
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.split('\n').filter(Boolean);
};

const FLOWS: Record<string, string[]> = {
  'alpha-one': ['tier0'],
  'bravo-two': ['tier1', 'pack-a'],
  'charlie-three': ['tier1', 'flaky'],
  'delta-four': ['tier0', 'pack-b'],
  'echo-five': ['tier1'],
  'foxtrot-six': ['tier2'],
  'golf-seven': ['tier0'],
};

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shard-flows-'));
  for (const [name, tags] of Object.entries(FLOWS)) {
    const header = `appId: com.example.app\ntags:\n${tags.map((t) => `  - ${t}`).join('\n')}\n---\n- launchApp\n`;
    fs.writeFileSync(path.join(dir, `${name}.yaml`), header);
  }
  fs.writeFileSync(path.join(dir, 'config.yaml'), 'flows:\n  - "*"\n');
  fs.mkdirSync(path.join(dir, 'helpers'));
  fs.writeFileSync(path.join(dir, 'helpers', 'setup.yaml'), '- launchApp\n');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const SELECTED = ['alpha-one', 'bravo-two', 'delta-four', 'echo-five', 'golf-seven'];

describe('gate flow sharding', () => {
  it.each([1, 2, 3, 4])('puts every selected flow in exactly one of %i shards', async (count) => {
    const select = await loadSelect();
    const all: string[] = [];
    for (let index = 1; index <= count; index++) {
      all.push(
        ...select({ dir, include: ['tier0', 'tier1'], exclude: ['flaky'], index, count }).map((f) =>
          path.basename(f, '.yaml')
        )
      );
    }
    expect(all.sort()).toEqual(SELECTED);
  });

  it('runs every flow in the one shard of a count of one', async () => {
    const select = await loadSelect();
    const files = select({
      dir,
      include: ['tier0', 'tier1'],
      exclude: ['flaky'],
      index: 1,
      count: 1,
    });
    expect(files).toHaveLength(SELECTED.length);
  });

  it('leaves a shard with no flow empty rather than failing', async () => {
    const select = await loadSelect();
    expect(
      select({ dir, include: ['tier0'], exclude: [], index: 3, count: 5 }).length
    ).toBeLessThanOrEqual(1);
    expect(select({ dir, include: ['nothing'], exclude: [], index: 1, count: 3 })).toEqual([]);
  });

  it('refuses an index outside the count', async () => {
    const select = await loadSelect();
    expect(() => select({ dir, include: ['tier0'], exclude: [], index: 4, count: 3 })).toThrow();
    expect(() => select({ dir, include: ['tier0'], exclude: [], index: 0, count: 3 })).toThrow();
  });
});

describe('the gate workflow', () => {
  const yaml = require('js-yaml') as {
    load: (source: string) => {
      jobs: Record<
        string,
        { strategy: { 'fail-fast': boolean; matrix: { shard: number[] } }; steps: unknown[] }
      >;
    };
  };
  const gate = yaml.load(
    fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/e2e-gate.yml'), 'utf8')
  );

  it('matrixes the gate job over three shards and reports each under its own name', () => {
    const job = gate.jobs.gate;
    expect(job.strategy['fail-fast']).toBe(false);
    expect(job.strategy.matrix.shard).toEqual([1, 2, 3]);
    const script = JSON.stringify(job.steps);
    expect(script).toContain('MAESTRO_SHARD');
    expect(script).toContain('e2e-gate-${{ matrix.shard }}-report');
    expect(script).toContain('e2e-gate-${{ matrix.shard }}-debug');
  });
});
