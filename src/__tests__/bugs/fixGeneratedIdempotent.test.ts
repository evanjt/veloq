/**
 * Scenario: `npm run fix-includes` runs on a tree whose CMakeLists has already
 * been fixed, which is every run after a binding regeneration.
 *
 * Expected behaviour: the second run changes nothing. The rename targets the
 * JSI library only, so `add_library(veloqrs SHARED IMPORTED)`, the Rust cdylib
 * that `set_target_properties` and the link line both name, keeps its name.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MODULE = join(__dirname, '../../../modules/veloqrs');
const SCRIPT = join(MODULE, 'scripts/fix-generated.sh');
const REAL_CMAKE = join(MODULE, 'android/CMakeLists.txt');

/** The shape uniffi-bindgen-react-native emits, plus the imported Rust cdylib. */
const GENERATED = `add_library(veloqrs            SHARED
    ../cpp/veloqrs.cpp
)

target_link_options(veloqrs PRIVATE "-Wl,-z,max-page-size=16384")

if (REACTNATIVE_MERGED_SO)
  target_link_libraries(veloqrs ReactAndroid::reactnative)
else()
  target_link_libraries(veloqrs
    ReactAndroid::turbomodulejsijni
  )
endif()

target_link_libraries(
  veloqrs
  fbjni::fbjni
)

add_library(veloqrs SHARED IMPORTED)
set_target_properties(veloqrs PROPERTIES
  IMPORTED_LOCATION \${CMAKE_SOURCE_DIR}/src/main/jniLibs/\${ANDROID_ABI}/libveloqrs.so
  IMPORTED_NO_SONAME TRUE
)
`;

const KOTLIN = `class VeloqrsModule {
  init {
      System.loadLibrary("veloqrs")
  }
}
`;

const roots: string[] = [];

/** A module tree the script can run against, holding the given CMakeLists. */
function moduleTree(cmake: string): string {
  const root = mkdtempSync(join(tmpdir(), 'fix-generated-'));
  roots.push(root);
  mkdirSync(join(root, 'android/src/main/java/com/veloq'), { recursive: true });
  mkdirSync(join(root, 'cpp'), { recursive: true });
  writeFileSync(join(root, 'android/CMakeLists.txt'), cmake);
  writeFileSync(join(root, 'android/src/main/java/com/veloq/VeloqrsModule.kt'), KOTLIN);
  writeFileSync(join(root, 'cpp/veloqrs.cpp'), '#include "/generated/veloqrs.hpp"\n');
  return root;
}

function run(root: string): void {
  execFileSync('bash', [SCRIPT], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
}

function cmakeOf(root: string): string {
  return readFileSync(join(root, 'android/CMakeLists.txt'), 'utf8');
}

function kotlinOf(root: string): string {
  return readFileSync(join(root, 'android/src/main/java/com/veloq/VeloqrsModule.kt'), 'utf8');
}

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('renames the JSI target and leaves the imported Rust library alone', () => {
  const root = moduleTree(GENERATED);
  run(root);
  const fixed = cmakeOf(root);

  expect(fixed).toContain('add_library(veloqrs_jni            SHARED');
  expect(fixed).toContain('target_link_libraries(veloqrs_jni ReactAndroid::reactnative)');
  expect(fixed).toContain('add_library(veloqrs SHARED IMPORTED)');
  expect(fixed).toContain('set_target_properties(veloqrs PROPERTIES');
});

it('changes nothing on a second run', () => {
  const root = moduleTree(GENERATED);
  run(root);
  const once = cmakeOf(root);
  run(root);

  expect(cmakeOf(root)).toBe(once);
});

it('leaves the repo CMakeLists byte-identical, since it is already fixed', () => {
  const root = moduleTree('');
  copyFileSync(REAL_CMAKE, join(root, 'android/CMakeLists.txt'));
  const before = cmakeOf(root);
  run(root);

  expect(cmakeOf(root)).toBe(before);
});

it('loads both libraries once, however many times it runs', () => {
  const root = moduleTree(GENERATED);
  run(root);
  run(root);
  const kotlin = kotlinOf(root);

  expect(kotlin.match(/System\.loadLibrary\("veloqrs_jni"\)/g)).toHaveLength(1);
  expect(kotlin.match(/System\.loadLibrary\("veloqrs"\)/g)).toHaveLength(1);
});
