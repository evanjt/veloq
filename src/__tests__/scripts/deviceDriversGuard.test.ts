/**
 * Scenario: a new script under `scripts/` drives the handset, with `adb shell
 * am force-stop` or a Maestro flow, and takes no lock, or takes the lock and
 * then runs Maestro bare, which picks a transport of its own and can drive the
 * other phone. The drivers used to be a list kept by hand, so a script nobody
 * added to it passed whatever it did.
 *
 * Expected behaviour: the guard finds every script that invokes `adb` or
 * Maestro, refuses one that does not take the device lock, and refuses a
 * Maestro call that does not go through `with-maestro.sh`. A mention in a
 * comment or a message is not an invocation, and the lock machinery itself is
 * not a driver.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { gitFreeEnv, initFixtureRepo } from '../__shared__/gitFixture';

const GUARD = path.resolve(__dirname, '../../../scripts/lint-device-drivers.mjs');

const LOCKED = [
  'if [ -z "${VELOQ_DEVICE_LOCK_HELD:-}" ]; then',
  '  exec "$(dirname "$0")/with-device-lock.sh" "$0" "$@"',
  'fi',
].join('\n');

function guard(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-drivers-'));
  for (const [file, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), body);
  }
  initFixtureRepo(root);
  try {
    const out = execFileSync('node', [GUARD, '--root', root], {
      encoding: 'utf8',
      env: gitFreeEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

describe('a script that drives the handset', () => {
  it('is refused when it runs adb without the lock', () => {
    const result = guard({
      'scripts/foo.sh': '#!/bin/sh\nadb shell am force-stop com.veloq.app.dev\n',
    });

    expect(result.code).not.toBe(0);
    expect(result.out).toContain('scripts/foo.sh');
  });

  it('is refused when it reaches adb through a variable without the lock', () => {
    const result = guard({
      'scripts/foo.sh': '#!/bin/sh\nADB=adb\n"$ADB" install -r app.apk\n',
    });

    expect(result.code).not.toBe(0);
  });

  it('is refused when a Node script shells out to adb without the lock', () => {
    const result = guard({
      'scripts/foo.mjs':
        "import { execSync } from 'node:child_process';\nexecSync(`adb shell input tap 1 1`);\n",
    });

    expect(result.code).not.toBe(0);
    expect(result.out).toContain('scripts/foo.mjs');
  });

  it('passes when it takes the lock', () => {
    const result = guard({
      'scripts/foo.sh': `#!/bin/sh\n${LOCKED}\nadb shell am force-stop com.veloq.app.dev\n`,
    });

    expect(result.code).toBe(0);
  });

  it('is refused when it runs Maestro bare, even inside the lock', () => {
    const result = guard({
      'scripts/foo.sh': `#!/bin/sh\n${LOCKED}\nmaestro test .maestro/upgrade/seed.yaml --no-ansi\n`,
    });

    expect(result.code).not.toBe(0);
    expect(result.out).toContain('with-maestro.sh');
  });

  it('is refused for a bare maestro hierarchy too', () => {
    const result = guard({
      'scripts/foo.sh': `#!/bin/sh\n${LOCKED}\nmaestro hierarchy 2>/dev/null | cat\n`,
    });

    expect(result.code).not.toBe(0);
  });

  it('is refused when a variable names the Maestro binary', () => {
    const result = guard({
      'scripts/foo.sh': `#!/bin/sh\n${LOCKED}\nMAESTRO="$HOME/.maestro/bin/maestro"\n"$MAESTRO" test flow.yaml\n`,
    });

    expect(result.code).not.toBe(0);
  });

  it('passes when a variable names the wrapper', () => {
    const result = guard({
      'scripts/foo.sh': `#!/bin/sh\n${LOCKED}\nMAESTRO="$(dirname "$0")/with-maestro.sh"\n"$MAESTRO" test flow.yaml\n`,
    });

    expect(result.code).toBe(0);
  });

  it('passes when Maestro goes through the wrapper', () => {
    const result = guard({
      'scripts/foo.sh': `#!/bin/sh\n${LOCKED}\n"$(dirname "$0")/with-maestro.sh" test flow.yaml\n`,
    });

    expect(result.code).toBe(0);
  });
});

describe('a shell script under .maestro', () => {
  it('is refused when it runs adb without the lock', () => {
    const result = guard({
      '.maestro/suite.sh': '#!/bin/sh\nadb kill-server\n',
    });

    expect(result.code).not.toBe(0);
    expect(result.out).toContain('.maestro/suite.sh');
  });

  it('passes when it takes the lock', () => {
    const result = guard({
      '.maestro/suite.sh': `#!/bin/sh\n${LOCKED}\nadb kill-server\n`,
    });

    expect(result.code).toBe(0);
  });
});

describe('what is not a driver', () => {
  it('passes a comment or a message that names adb', () => {
    const result = guard({
      'scripts/foo.sh':
        '#!/bin/sh\n# Read it with adb logcat -s veloqrs.\necho "clear it with adb disconnect"\n',
      'scripts/bar.mjs': '// which is why `adb logcat -s veloqrs` shows nothing\nexport {};\n',
    });

    expect(result.code).toBe(0);
  });

  it('passes a Node message that starts with the word', () => {
    const result = guard({
      'scripts/foo.mjs': 'console.log(`maestro id guard: 3 ids asserted`);\n',
    });

    expect(result.code).toBe(0);
  });

  it('passes the lock machinery, which reads adb to choose the lock', () => {
    const result = guard({
      'scripts/device-lock-path.sh': 'attached=$(adb devices | awk \'$2 == "device"\')\n',
    });

    expect(result.code).toBe(0);
  });

  it('passes a check that only asks whether the tool is installed', () => {
    const result = guard({
      'scripts/foo.sh':
        '#!/bin/sh\ncommand -v maestro >/dev/null || exit 1\ncommand -v adb >/dev/null 2>&1\n',
    });

    expect(result.code).toBe(0);
  });
});
