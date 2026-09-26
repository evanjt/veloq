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

/**
 * A lock of this test's own, so nothing here waits on the fleet. Every case
 * that runs the script has to pass this: the script's default is the real
 * build lock, and a build holds that for a quarter of an hour. Taking it here
 * blocked one case for the build's whole duration and timed the other out,
 * which failed the suite on a machine that was only busy.
 */
function privateLock(): NodeJS.ProcessEnv {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-android-build-'));
  return { ...process.env, VELOQ_ANDROID_BUILD_LOCK: path.join(dir, 'lock') };
}

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

  it('never runs the script on the lock a real build holds', () => {
    // The script's default is the fleet's own lock, which a build holds for a
    // quarter of an hour. A case here that takes it fails on a machine that is
    // merely busy, and says nothing about the script.
    const source = fs.readFileSync(path.join(__dirname, 'androidBuildLock.test.ts'), 'utf8');
    const calls = source
      .split(/\bspawnSync?\(/)
      .slice(1)
      .filter((chunk) => chunk.slice(0, 120).includes('script'));
    expect(calls.length).toBeGreaterThan(0);
    // Each one hands the child an environment, and every environment this file
    // builds names a lock of its own.
    for (const call of calls) {
      expect(call.slice(0, 400)).toMatch(/\benv\b/);
    }
    for (const env of source.split(/\.\.\.process\.env/).slice(1)) {
      expect(env.slice(0, 120)).toContain('VELOQ_ANDROID_BUILD_LOCK');
    }
  });

  it('runs under an outer flock rather than waiting on itself', () => {
    // The shape the guide's recipe creates: an outer lock taken by hand, the
    // script's own taken inside it. Both stand in for the real ones.
    const outer = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-outer-')), 'lock');
    const run = spawnSync('flock', [outer, script, 'echo', 'nested'], {
      encoding: 'utf8',
      timeout: 15000,
      env: privateLock(),
    });
    expect(run.status).toBe(0);
    expect(run.stdout).toContain('nested');
  });

  it('passes the command through and keeps its exit code', () => {
    const env = privateLock();
    const ok = spawnSync(script, ['echo', 'built'], { encoding: 'utf8', env });
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain('built');
    expect(spawnSync(script, ['false'], { encoding: 'utf8', env }).status).not.toBe(0);
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
