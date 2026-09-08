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

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import jestConfig from '../../../config/jest.config.js';

/** The number the config commits to, with any operator override set aside. */
function committedMaxWorkers(): unknown {
  const override = process.env.JEST_WORKERS;
  delete process.env.JEST_WORKERS;
  jest.resetModules();
  try {
    return require('../../../config/jest.config.js').maxWorkers;
  } finally {
    if (override !== undefined) process.env.JEST_WORKERS = override;
  }
}

/**
 * The ceiling is a number and not a fraction of the cores. It protects the
 * shared development box, so a CI runner's four cores say nothing about it:
 * against `cpus().length / 4` the committed 4 read as three times the budget
 * and failed a run that was taking two workers.
 */
const CEILING = 4;

describe('how many workers a run takes', () => {
  it('caps the count rather than taking the cores-1 default', () => {
    expect(typeof jestConfig.maxWorkers).toBe('number');
    expect(jestConfig.maxWorkers).toBeGreaterThan(0);
  });

  it('commits to a bounded number, whatever machine reads the config', () => {
    expect(committedMaxWorkers()).toBeLessThanOrEqual(CEILING);
  });

  it('recycles a leaked worker rather than holding it to the end of the run', () => {
    expect(jestConfig.workerIdleMemoryLimit).toBeDefined();
  });

  it('lets an idle machine have its cores back without editing the config', () => {
    const config = readFileSync(resolve(__dirname, '../../../config/jest.config.js'), 'utf8');

    expect(config).toContain('JEST_WORKERS');
  });
});
