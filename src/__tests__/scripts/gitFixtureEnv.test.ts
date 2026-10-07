/**
 * Scenario: a commit made with `VELOQ_SKIP_GATES=tsc` runs the suites that
 * drive the gate runner in a fixture. The fixture environment dropped git's
 * variables and kept the rest, so the runner under test skipped `tsc` too, and
 * a case that asserted nothing was skipped failed on a commit that had nothing
 * to do with it.
 *
 * Expected behaviour: the environment a fixture starts from carries none of the
 * `VELOQ_*` switches the calling session set. A fixture that means one sets it
 * after the call.
 */

import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import { gitFreeEnv } from '../__shared__/gitFixture';

const RUN_GATES = join(__dirname, '../../../scripts/run-gates.sh');

/** A caller's environment with only the variables a case names. */
const callerEnv = (vars: Record<string, string>) => vars as NodeJS.ProcessEnv;

describe('the fixture environment', () => {
  it('drops every VELOQ_ variable the caller inherited, and nothing else', () => {
    const env = gitFreeEnv(
      callerEnv({
        PATH: '/usr/bin',
        HOME: '/home/fixture',
        VELOQ_SKIP_GATES: 'tsc',
        VELOQ_MERGE_BASE: 'abc123',
        VELOQ_DEVICE_LOCK_HELD: '1',
        GIT_DIR: '/elsewhere/.git',
      })
    );

    expect(Object.keys(env).filter((key) => key.startsWith('VELOQ_'))).toEqual([]);
    expect(env.GIT_DIR).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/fixture');
  });

  it('drops a skip the running session exported', () => {
    const before = process.env.VELOQ_SKIP_GATES;
    process.env.VELOQ_SKIP_GATES = 'tsc';
    try {
      expect(gitFreeEnv().VELOQ_SKIP_GATES).toBeUndefined();
    } finally {
      if (before === undefined) delete process.env.VELOQ_SKIP_GATES;
      else process.env.VELOQ_SKIP_GATES = before;
    }
  });

  it('keeps a variable a fixture sets after the call', () => {
    expect({
      ...gitFreeEnv(callerEnv({ VELOQ_SKIP_GATES: 'lint' })),
      VELOQ_SKIP_GATES: 'tsc',
    }).toMatchObject({
      VELOQ_SKIP_GATES: 'tsc',
    });
  });

  it('runs the gate runner skipping nothing under a session that exported a skip', () => {
    const before = process.env.VELOQ_SKIP_GATES;
    process.env.VELOQ_SKIP_GATES = 'tsc';
    const run = (gate: string): { status: number; output: string } => {
      try {
        const output = execFileSync('sh', ['-e', RUN_GATES, gate], {
          encoding: 'utf8',
          env: gitFreeEnv(),
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        return { status: 0, output };
      } catch (error) {
        const e = error as { status: number; stdout?: string; stderr?: string };
        return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
      }
    };
    try {
      expect(run('tsc:true').output).not.toMatch(/skipp/i);
      expect(run('tsc:exit 1').status).toBe(1);
    } finally {
      if (before === undefined) delete process.env.VELOQ_SKIP_GATES;
      else process.env.VELOQ_SKIP_GATES = before;
    }
  });
});
