/**
 * Scenario: tooling suites build fixtures with `mkdtemp` and a missed cleanup
 * leaks one directory per run until /tmp has no inodes left.
 * Expected behaviour: every directory made through a tracked `fs` is removed
 * with its contents by `removeAll`, however the suite made it.
 */

import * as realFs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const { installTempDirTracker } = require('../../../config/jest.tempDirs.js');

type FsLike = typeof realFs & Record<symbol, unknown>;

function freshFs(): FsLike {
  return { ...realFs } as FsLike;
}

describe('installTempDirTracker', () => {
  it('removes a directory made by mkdtempSync, contents included', () => {
    const fs = freshFs();
    const tracker = installTempDirTracker(fs);
    const dir = fs.mkdtempSync(join(tmpdir(), 'tracker-sync-'));
    fs.mkdirSync(join(dir, 'nested'));
    fs.writeFileSync(join(dir, 'nested', 'file.txt'), 'x');

    expect(tracker.removeAll()).toEqual([dir]);
    expect(realFs.existsSync(dir)).toBe(false);
  });

  it('removes a directory made by the callback mkdtemp', async () => {
    const fs = freshFs();
    const tracker = installTempDirTracker(fs);
    const dir = await new Promise<string>((resolve, reject) =>
      fs.mkdtemp(join(tmpdir(), 'tracker-cb-'), (err, made) => (err ? reject(err) : resolve(made)))
    );

    expect(realFs.existsSync(dir)).toBe(true);
    tracker.removeAll();
    expect(realFs.existsSync(dir)).toBe(false);
  });

  it('removes every directory, and none a second time', () => {
    const fs = freshFs();
    const tracker = installTempDirTracker(fs);
    const a = fs.mkdtempSync(join(tmpdir(), 'tracker-a-'));
    const b = fs.mkdtempSync(join(tmpdir(), 'tracker-b-'));

    expect(tracker.removeAll().sort()).toEqual([a, b].sort());
    expect(tracker.removeAll()).toEqual([]);
  });

  it('is one tracker however often it is installed', () => {
    const fs = freshFs();
    const first = installTempDirTracker(fs);
    const second = installTempDirTracker(fs);
    const dir = fs.mkdtempSync(join(tmpdir(), 'tracker-twice-'));

    expect(second).toBe(first);
    expect(first.removeAll()).toEqual([dir]);
  });

  it('leaves a directory it did not make', () => {
    const fs = freshFs();
    const tracker = installTempDirTracker(fs);
    const other = realFs.mkdtempSync(join(tmpdir(), 'tracker-other-'));
    try {
      tracker.removeAll();
      expect(realFs.existsSync(other)).toBe(true);
    } finally {
      realFs.rmSync(other, { recursive: true, force: true });
    }
  });

  it('does not track a failed mkdtemp', async () => {
    const fs = freshFs();
    const tracker = installTempDirTracker(fs);
    const missing = join(tmpdir(), 'tracker-no-such-parent', 'x-');
    await new Promise<void>((resolve) => fs.mkdtemp(missing, () => resolve()));

    expect(tracker.removeAll()).toEqual([]);
  });
});
