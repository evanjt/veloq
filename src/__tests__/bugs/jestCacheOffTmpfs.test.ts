/**
 * Scenario: `cacheDirectory` was unset, so Jest fell back to the system temp
 * directory, which on this machine is a 16 GB tmpfs. Every transform cache and
 * haste map was resident memory, the path is keyed on the project root so each
 * worktree got its own, and a removed worktree left its cache behind. Measured
 * at 8.4 GB across 354 directories with five sessions running, and three
 * sessions died within seven minutes of each other with `/tmp` full.
 *
 * Expected behaviour: the cache is written to disk under the repo, per
 * worktree so parallel runs still do not share one. The failure mode is a
 * silent default, so the config is what has to be asserted: nothing else would
 * notice it coming back.
 */

import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';

import jestConfig from '../../../config/jest.config.js';

const REPO_ROOT = resolve(__dirname, '../../..');

describe('where Jest writes its caches', () => {
  it('sets a cache directory rather than taking the default', () => {
    expect(typeof jestConfig.cacheDirectory).toBe('string');
    expect(jestConfig.cacheDirectory.length).toBeGreaterThan(0);
  });

  it('does not resolve under the system temp directory', () => {
    const cache = resolve(jestConfig.cacheDirectory);
    expect(cache.startsWith(resolve(tmpdir()) + sep)).toBe(false);
    expect(cache).not.toBe(resolve(tmpdir()));
  });

  it('writes under the repo the run was started from', () => {
    expect(resolve(jestConfig.cacheDirectory).startsWith(REPO_ROOT + sep)).toBe(true);
  });

  it('is ignored, so a cache never reaches a commit', () => {
    const { execFileSync } = require('node:child_process');
    const probe = resolve(jestConfig.cacheDirectory, 'probe');
    const ignored = execFileSync('git', ['check-ignore', probe], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });

    expect(ignored.trim().length).toBeGreaterThan(0);
  });
});
