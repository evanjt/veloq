/**
 * Scenario: CodeQL extracts Kotlin and Java only from the compile it traces,
 * and a C header only through a source that includes it. A native module, a
 * source set or a header the traced compile never reaches is shipped unscanned,
 * and the code scanning status page reports the language below 100 % with
 * nothing saying which file.
 *
 * Expected behaviour: the guard passes a tree whose every Kotlin, Java and C
 * header is compiled from its tracked path, included by a C or C++ source, or
 * named in the CodeQL config's `paths-ignore`, and refuses any other file,
 * naming it.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { gitFreeEnv, runGit } from '../__shared__/gitFixture';

const projectRoot = path.join(__dirname, '../../..');
const script = path.join(projectRoot, 'scripts/check-codeql-coverage.mjs');

const COMPILE = `#!/usr/bin/env bash
PROJECTS=(
  :app
  :lantern
)
TASKS=(compileReleaseKotlin compileReleaseJavaWithJavac)
APP_SOURCES=(
  beacon/android/java # compiled in place
)
`;

const CONFIG = `name: CodeQL
paths-ignore:
  - modules/*/android/src/test
  - '**/ios/**/*.h'
`;

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-codeql-coverage-'));
  runGit(['init', '--quiet'], root);
  write('scripts/codeql-android-compile.sh', COMPILE);
  write('.github/codeql/codeql-config.yml', CONFIG);
  write('modules/lantern/android/src/main/java/com/example/Lantern.kt', '');
  write('modules/lantern/android/src/main/java/com/example/Wick.java', '');
  write('modules/lantern/android/src/release/java/com/example/Glow.kt', '');
  write('modules/lantern/android/src/test/java/com/example/LanternTest.kt', '');
  write('beacon/android/java/Beacon.kt', '');
  write('modules/lantern/cpp/lantern.cpp', '#include "lantern.h"\n');
  write('modules/lantern/cpp/lantern.h', '');
  write('modules/lantern/ios/Flame.h', '');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), content);
  runGit(['add', file], root);
}

function guard() {
  return spawnSync('node', [script, '--root', root], { encoding: 'utf8', env: gitFreeEnv() });
}

it('passes a tree whose every file is compiled, included or ignored', () => {
  const run = guard();
  expect(run.stderr).toBe('');
  expect(run.status).toBe(0);
});

it('refuses the Kotlin of a module the traced compile does not name', () => {
  write('modules/candle/android/src/main/java/com/example/Candle.kt', '');
  const run = guard();
  expect(run.status).toBe(1);
  expect(run.stderr).toContain('modules/candle/android/src/main/java/com/example/Candle.kt');
});

it('refuses a source set of a named module that the traced variant does not compile', () => {
  write('modules/lantern/android/src/debug/java/com/example/Spark.kt', '');
  write('modules/lantern/android/src/androidTest/java/com/example/Probe.java', '');
  const run = guard();
  expect(run.status).toBe(1);
  expect(run.stderr).toContain('src/debug/java/com/example/Spark.kt');
  expect(run.stderr).toContain('src/androidTest/java/com/example/Probe.java');
  expect(run.stderr).not.toContain('Lantern.kt');
});

it('refuses Kotlin outside a module that the compile does not take in place', () => {
  write('beacon/android/extra/Signal.kt', '');
  const run = guard();
  expect(run.status).toBe(1);
  expect(run.stderr).toContain('beacon/android/extra/Signal.kt');
  expect(run.stderr).not.toContain('Beacon.kt');
});

it('refuses a C header no C or C++ source includes, and passes it once one does', () => {
  write('modules/lantern/cpp/ember.h', '');
  expect(guard().stderr).toContain('modules/lantern/cpp/ember.h');
  write('modules/lantern/cpp/ember.cpp', '#include "ember.h"\n');
  expect(guard().status).toBe(0);
});

it('refuses everything the config stops ignoring', () => {
  write('.github/codeql/codeql-config.yml', 'name: CodeQL\n');
  const run = guard();
  expect(run.status).toBe(1);
  expect(run.stderr).toContain('LanternTest.kt');
  expect(run.stderr).toContain('modules/lantern/ios/Flame.h');
});

it('refuses everything the compile stops taking in place', () => {
  write('scripts/codeql-android-compile.sh', COMPILE.replace(/APP_SOURCES=\([^)]*\)/, ''));
  const run = guard();
  expect(run.status).toBe(1);
  expect(run.stderr).toContain('beacon/android/java/Beacon.kt');
});
