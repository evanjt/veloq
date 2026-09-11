/**
 * Scenario: two agent sessions build the Android app at the same moment, one
 * of them having forgotten to wrap the build in the lock by hand.
 *
 * Expected behaviour: the second waits. Every worktree shares the one
 * `android/` tree, because `android/` is almost entirely gitignored, so two
 * `assembleDebug` runs write the same `mergeDebugResources` directory. When
 * that happened the merge failed on five locale resource files that name
 * nothing about the collision, and thirteen minutes of build went with it.
 *
 * The lock is the build's own. Re-taking the one the guide tells an agent to
 * wrap a build in would deadlock the child against its own parent, so this
 * takes a second lock every build passes through either way.
 */
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const projectRoot = path.join(__dirname, '../../..');
const script = path.join(projectRoot, 'scripts/with-android-build-lock.sh');

const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

describe('the Android build takes a lock of its own', () => {
  it('is what the build scripts run through', () => {
    for (const name of [
      'android',
      'android:debug',
      'android:prod',
      'rebuild:android',
      'rebuild:android:prod',
    ]) {
      expect(packageJson.scripts[name]).toContain('with-android-build-lock.sh');
    }
  });

  it('takes a lock of its own, so a hand-wrapped build cannot wait on itself', () => {
    const source = fs.readFileSync(script, 'utf8');
    expect(source).toContain('veloq-android-build.lock');
    expect(source).not.toContain('veloq-merge.lock');
    // Re-taking the lock the guide wraps a build in would deadlock the child
    // against its own parent.
    expect(source).not.toMatch(/lock="[^"]*veloq-build\.lock"/);
    // A session-private temp directory would be a lock nobody else can see.
    expect(source).not.toContain('TMPDIR');
  });

  it('runs under an outer flock rather than waiting on itself', () => {
    // The shape the guide's recipe creates. A temp file stands in for the
    // build lock: taking the real one here would queue behind whatever the
    // fleet is building.
    const outer = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-outer-')), 'lock');
    const run = spawnSync('flock', [outer, script, 'echo', 'nested'], {
      encoding: 'utf8',
      timeout: 15000,
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('nested');
  });

  it('passes the command through and keeps its exit code', () => {
    const ok = spawnSync(script, ['echo', 'built'], { encoding: 'utf8' });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('built');
    expect(spawnSync(script, ['false'], { encoding: 'utf8' }).status).not.toBe(0);
  });

  it('serialises two runs rather than letting them interleave', async () => {
    const marker = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-lock-')), 'order');
    const run = (tag: string) =>
      new Promise<void>((resolve) => {
        const child = spawn(
          script,
          ['sh', '-c', `echo ${tag}-in >> ${marker}; sleep 0.4; echo ${tag}-out >> ${marker}`],
          { stdio: 'ignore', env: { ...process.env, VELOQ_ANDROID_BUILD_LOCK: `${marker}.lock` } }
        );
        child.on('close', () => resolve());
      });

    await Promise.all([run('a'), run('b')]);

    const order = fs.readFileSync(marker, 'utf8').trim().split('\n');
    // Interleaved would be a-in, b-in, a-out, b-out. Serialised is one pair
    // then the other, whichever wins the lock.
    expect(order[0].replace(/-in$/, '')).toBe(order[1].replace(/-out$/, ''));
    expect(order[2].replace(/-in$/, '')).toBe(order[3].replace(/-out$/, ''));
  });
});
