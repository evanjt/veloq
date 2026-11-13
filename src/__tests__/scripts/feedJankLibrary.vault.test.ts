/**
 * Scenario: the feed jank rig runs on a handset that already holds a
 * signed-in library, so no login screen appears and demo mode is never
 * entered.
 *
 * Expected behaviour: the runs are counted and every line names the library
 * it was taken on. A library that changes between two entries ends the set
 * with a refusal, since runs from two libraries are not one measurement.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const projectRoot = path.join(__dirname, '../../..');

type Library = 'demo' | 'signed-in';

// `libraries` is the library each entry lands on, in order; the last repeats.
// `failGuardCalls` are the guard calls that fail, forcing a re-entry.
function rig(
  libraries: Library[],
  failGuardCalls: number[],
  runs: number
): { lines: string[]; status: number | null } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-jank-library-'));
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
    `libs=(${libraries.join(' ')})
entries=$(cat ${state}/entries 2>/dev/null || echo 0)
i=$(( entries > 0 ? entries - 1 : 0 )); [ $i -ge \${#libs[@]} ] && i=$(( \${#libs[@]} - 1 ))
on=\${libs[$i]}
case "$*" in
  *enter.yaml*) echo $(( entries + 1 )) > ${state}/entries ;;
  *demo-library.yaml*) [ "$on" = demo ] || exit 1 ;;
  *signed-in-library.yaml*) [ "$on" = signed-in ] || exit 1 ;;
  *guard.yaml*)
    n=$(( $(cat ${state}/guards 2>/dev/null || echo 0) + 1 )); echo $n > ${state}/guards
    case " ${failGuardCalls.join(' ')} " in *" $n "*) exit 1 ;; esac ;;
esac
exit 0`
  );
  write(
    'adb',
    `case "$*" in
  *"gfxinfo"*reset*) ;;
  *gfxinfo*) echo "Total frames rendered: 3000"; echo "Janky frames: 50 (1.67%)" ;;
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
      // Keeps the host's Maestro lock, which sits beside the device locks, inside this rig.
      VELOQ_DEVICE_LOCK_DIR: root,
      ANDROID_SERIAL: 'serial',
    },
  });
  return { lines: result.stdout.split('\n').filter(Boolean), status: result.status };
}

const numbered = (lines: string[]) => lines.filter((l) => /^t \d+ /.test(l));

describe('measure-feed-jank library', () => {
  it('counts runs on a signed-in library and labels each one', () => {
    const { lines, status } = rig(['signed-in'], [], 3);
    expect(status).toBe(0);
    expect(numbered(lines)).toHaveLength(3);
    for (const l of numbered(lines)) expect(l).toContain('library=signed-in');
    expect(lines.find((l) => l.startsWith('t warm-up'))).toContain('library=signed-in');
  });

  it('labels runs on the demo library', () => {
    const { lines, status } = rig(['demo'], [], 2);
    expect(status).toBe(0);
    expect(numbered(lines)).toHaveLength(2);
    for (const l of numbered(lines)) expect(l).toContain('library=demo');
  });

  it('keeps counting across a re-entry that lands on the same library', () => {
    // Warm-up takes guards 1 and 2, run 1 takes 3 and 4, run 2 fails at 6.
    const { lines, status } = rig(['signed-in', 'signed-in'], [6], 3);
    expect(status).toBe(0);
    expect(numbered(lines)).toHaveLength(3);
  });

  it('refuses the set when a re-entry lands on another library', () => {
    const { lines, status } = rig(['signed-in', 'demo'], [6], 3);
    expect(status).not.toBe(0);
    expect(numbered(lines)).toHaveLength(1);
    expect(lines.some((l) => /REFUSED.*signed-in.*demo/.test(l))).toBe(true);
  });

  it('fails the entry when neither library is on screen', () => {
    const { lines, status } = rig([], [], 2);
    expect(status).not.toBe(0);
    expect(numbered(lines)).toHaveLength(0);
    expect(lines).toContain('t ENTRY FAILED');
  });
});
