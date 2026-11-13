/**
 * Scenario: the guard runner sized itself at half the cores, so every audit and
 * every landing on a shared box ran sixteen guards at once and they were the
 * box's largest CPU user.
 * Expected behaviour: the runner takes a fixed default of 4, like Jest, and an
 * operator or CI sets its own number through GUARD_WORKERS.
 */

import { execFileSync } from 'child_process';
import { join } from 'path';

const MODULE = join(__dirname, '../../../scripts/lib/guardWorkers.mjs');

const guardWorkers = (env: Record<string, string>): number =>
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `import { guardWorkers } from ${JSON.stringify(MODULE)};
         console.log(JSON.stringify(guardWorkers(JSON.parse(process.argv[1]))));`,
        JSON.stringify(env),
      ],
      { encoding: 'utf8' }
    )
  );

describe('guardWorkers', () => {
  it('defaults to 4 when GUARD_WORKERS is unset', () => {
    expect(guardWorkers({})).toBe(4);
  });

  it('takes GUARD_WORKERS when it is set', () => {
    expect(guardWorkers({ GUARD_WORKERS: '2' })).toBe(2);
    expect(guardWorkers({ GUARD_WORKERS: '12' })).toBe(12);
  });

  it.each(['', '0', '-3', 'many', '2.5'])('falls back to 4 for GUARD_WORKERS=%j', (value) => {
    expect(guardWorkers({ GUARD_WORKERS: value })).toBe(4);
  });
});
