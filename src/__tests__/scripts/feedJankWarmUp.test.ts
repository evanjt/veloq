/**
 * Scenario: the feed jank rig runs after an entry, and again after a run that
 * failed its checks and forced a re-entry.
 *
 * Expected behaviour: the first run after every entry is a warm-up. It is
 * printed as such and never numbered, so every numbered line is a settled run.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const projectRoot = path.join(__dirname, '../../..');

function rig(failGuardCalls: number[], runs: number): { lines: string[]; status: number | null } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-jank-'));
  const bin = path.join(root, 'scripts');
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(root, '.maestro/jank'), { recursive: true });
  fs.copyFileSync(
    path.join(projectRoot, 'scripts/measure-feed-jank.sh'),
    path.join(bin, 'measure-feed-jank.sh')
  );
  const state = path.join(root, 'state');
  fs.mkdirSync(state);
  const write = (name: string, body: string) =>
    fs.writeFileSync(path.join(bin, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 });
  write('install-apk.sh', 'exit 0');
  write(
    'with-maestro.sh',
    `case "$*" in
  *guard.yaml*)
    n=$(( $(cat ${state}/guards 2>/dev/null || echo 0) + 1 )); echo $n > ${state}/guards
    case " ${failGuardCalls.join(' ')} " in *" $n "*) exit 1 ;; esac ;;
esac
exit 0`
  );
  write(
    'adb',
    `case "$*" in
  *force-stop*) touch ${state}/cold ;;
  *"gfxinfo"*reset*) ;;
  *gfxinfo*)
    echo "Total frames rendered: 3000"
    if [ -e ${state}/cold ]; then rm ${state}/cold; echo "Janky frames: 190 (6.34%)"
    else echo "Janky frames: 50 (1.67%)"; fi ;;
  *"dumpsys window"*) echo "mCurrentFocus=Window{x u0 com.veloq.app.dev/com.veloq.app.dev.MainActivity}" ;;
esac
exit 0`
  );
  write('sleep', 'exit 0');
  const result = spawnSync(path.join(bin, 'measure-feed-jank.sh'), ['t', 'app.apk', String(runs)], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      VELOQ_DEVICE_LOCK_HELD: '1',
      ANDROID_SERIAL: 'serial',
    },
  });
  return { lines: result.stdout.split('\n').filter(Boolean), status: result.status };
}

const numbered = (lines: string[]) => lines.filter((l) => /^t \d+ /.test(l));

describe('measure-feed-jank warm-up', () => {
  it('numbers only settled runs after the first entry', () => {
    const { lines } = rig([], 3);
    expect(lines.filter((l) => l.startsWith('t warm-up'))).toHaveLength(1);
    expect(numbered(lines)).toHaveLength(3);
    for (const l of numbered(lines)) expect(l).toContain('pct=1.67');
  });

  it('treats the run after a mid-sequence re-entry as a warm-up too', () => {
    // Warm-up takes guards 1 and 2, run 1 takes 3 and 4, run 2 fails at 6.
    const { lines } = rig([6], 3);
    expect(lines.filter((l) => l.startsWith('t warm-up'))).toHaveLength(2);
    expect(numbered(lines)).toHaveLength(3);
    for (const l of numbered(lines)) expect(l).toContain('pct=1.67');
  });

  it('discards a rejected initial warm-up before numbering settled runs', () => {
    const { lines, status } = rig([1], 3);
    expect(status).toBe(0);
    expect(numbered(lines)).toHaveLength(3);
    for (const line of numbered(lines)) expect(line).toContain('pct=1.67');
  });

  it('discards a rejected warm-up after re-entry', () => {
    const { lines, status } = rig([6, 7], 3);
    expect(status).toBe(0);
    expect(numbered(lines)).toHaveLength(3);
    for (const line of numbered(lines)) expect(line).toContain('pct=1.67');
  });

  it('fails after repeated warm-up rejection without numbering a cold run', () => {
    const { lines, status } = rig([1, 2, 3, 4, 5, 6, 7, 8, 9], 3);
    expect(status).not.toBe(0);
    expect(numbered(lines)).toHaveLength(0);
  });
});
