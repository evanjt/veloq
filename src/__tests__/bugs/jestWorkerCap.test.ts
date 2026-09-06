/**
 * Scenario: `maxWorkers` was unset, so Jest took its default of cores-1, which
 * is 31 on the box this is developed on. The pre-commit hook runs `npm test` as
 * one of five parallel gates and several agent sessions run the suite at once,
 * so the default multiplied. The global OOM on 2026-09-05 killed processes
 * across the machine, and the kernel's own task dump held 74 `node-MainThread`
 * workers at 15.0 GB between them, against rustc's 1.8 GB.
 *
 * Expected behaviour: a run takes a bounded number of workers, and a leaked one
 * is recycled rather than held. Like `jestCacheOffTmpfs`, the failure mode is a
 * silent default, so the config is what has to be asserted: a run that takes 31
 * workers passes every test in the suite right up until the machine dies.
 */

import { cpus } from 'node:os';

import jestConfig from '../../../config/jest.config.js';

describe('how many workers a run takes', () => {
  it('caps the count rather than taking the cores-1 default', () => {
    expect(typeof jestConfig.maxWorkers).toBe('number');
    expect(jestConfig.maxWorkers).toBeGreaterThan(0);
  });

  it('stays well under the core count, which is what the default tracks', () => {
    // The cap exists because several sessions share one machine, so it has to
    // be a fraction of the box and not merely below it.
    expect(jestConfig.maxWorkers).toBeLessThanOrEqual(Math.max(2, cpus().length / 4));
  });

  it('recycles a leaked worker rather than holding it to the end of the run', () => {
    expect(jestConfig.workerIdleMemoryLimit).toBeDefined();
  });

  it('lets an idle machine have its cores back without editing the config', () => {
    const config = String(require('node:fs').readFileSync(
      require('node:path').resolve(__dirname, '../../../config/jest.config.js'),
      'utf8'
    ));

    expect(config).toContain('JEST_WORKERS');
  });
});
