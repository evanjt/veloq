/**
 * Scenario: an engine date is the athlete's wall clock stamped as UTC, so
 * `new Date(seconds * 1000)` handed to a local formatter prints the neighbouring
 * day outside UTC. `src/shared/time/startDate.ts` and `format.ts` own the read.
 *
 * Expected behaviour: the guard fails a raw read anywhere else, passes the same
 * line carrying an allow marker with a reason, exempts the two owners and the
 * tests, holds a baseline that may only shrink, and fails a zoneless
 * `start_date_local` parsed with `new Date` into epoch seconds.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-engine-date-reads.mjs');
const SCREEN = 'src/features/orchards/lib/harvestDates.ts';
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function runGuard(
  files: Record<string, string>,
  baseline: Record<string, number> = {}
): { status: number; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'engine-date-reads-'));
  roots.push(root);
  for (const [path, contents] of Object.entries({ 'src/index.ts': 'export {};\n', ...files })) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  try {
    const baselineFile = join(root, 'baseline.json');
    writeFileSync(baselineFile, JSON.stringify(baseline));
    const output = execFileSync('node', [SCRIPT, '--root', root, '--baseline', baselineFile], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const RAW = 'const label = formatShortDate(new Date(ride.date * 1000));\n';

describe('engine date reads', () => {
  it('fails a raw epoch-seconds read and names the line', () => {
    const { status, output } = runGuard({ [SCREEN]: `\n${RAW}` });
    expect(status).toBe(1);
    expect(output).toContain(`${SCREEN}:2`);
  });

  it('fails a zoneless start_date_local turned into epoch seconds', () => {
    const { status, output } = runGuard({
      [SCREEN]: 'const t = Math.floor(new Date(a.start_date_local).getTime() / 1000);\n',
    });
    expect(status).toBe(1);
    expect(output).toContain(`${SCREEN}:1`);
  });

  it('passes a true instant that carries a marker with a reason', () => {
    const { status } = runGuard({
      [SCREEN]: 'const t = new Date(run.ts * 1000); // true-instant: a recorded run time\n',
    });
    expect(status).toBe(0);
  });

  it('fails a marker with no reason', () => {
    const { status } = runGuard({
      [SCREEN]: 'const t = new Date(run.ts * 1000); // true-instant:\n',
    });
    expect(status).toBe(1);
  });

  it('exempts the two owners and the tests', () => {
    const { status } = runGuard({
      'src/shared/time/startDate.ts': RAW,
      'src/shared/format/format.ts': RAW,
      'src/__tests__/lib/harvest.test.ts': RAW,
    });
    expect(status).toBe(0);
  });

  it('passes a read the baseline records', () => {
    expect(runGuard({ [SCREEN]: RAW }, { [SCREEN]: 1 }).status).toBe(0);
  });

  it('fails a file above its baseline count', () => {
    expect(runGuard({ [SCREEN]: RAW + RAW }, { [SCREEN]: 1 }).status).toBe(1);
  });

  it('fails a stale baseline entry whose reads are gone', () => {
    const { status, output } = runGuard({ [SCREEN]: 'export {};\n' }, { [SCREEN]: 1 });
    expect(status).toBe(1);
    expect(output).toContain(SCREEN);
  });
});
