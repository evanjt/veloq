/**
 * Scenario: React Native 0.87 stopped calling the one-argument
 * `installJSIBindingsWithRuntime:` and asks a TurboModule only for
 * `installJSIBindingsWithRuntime:callInvoker:`. A native module that still implements the
 * old selector alone builds cleanly and never installs its bindings, and nitro-modules turns
 * that into an abort at every iOS launch.
 *
 * Expected behaviour: the guard reads the selectors the installed React Native calls, and
 * refuses any installed iOS module whose JSI-bindings method answers none of them, naming
 * the file and the selector it implements. It passes a module that answers the called one,
 * stays quiet with no React Native installed, and refuses a React Native whose caller names
 * no selector, rather than passing every module unchecked.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { gitFreeEnv } from '../__shared__/gitFixture';

const nitro = require('../../../scripts/patch-nitro-jsi-install');

const projectRoot = join(__dirname, '../../..');
const GUARD = join(projectRoot, 'scripts/check-jsi-bindings-selector.mjs');
const MANAGER =
  'node_modules/react-native/ReactCommon/react/nativemodule/core/platform/ios/ReactCommon/RCTTurboModuleManager.mm';

const installedManager = readFileSync(join(projectRoot, MANAGER), 'utf8');
const shippedNitro: string = nitro.unpatchSource(
  readFileSync(join(projectRoot, 'node_modules/react-native-nitro-modules', nitro.FILE), 'utf8')
);

const OLD_ONLY = `@implementation FixtureBindings
- (void)installJSIBindingsWithRuntime:(facebook::jsi::Runtime &)runtime
{
  install(runtime);
}
@end
`;

const CURRENT = `@implementation FixtureBindings
- (void)
    installJSIBindingsWithRuntime:(facebook::jsi::Runtime &)runtime
                      callInvoker:(const std::shared_ptr<facebook::react::CallInvoker> &)callInvoker
{
  install(runtime, callInvoker);
}
@end
`;

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function write(root: string, file: string, source: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), source);
}

/** A checkout with the given React Native caller and native sources, each path to its text. */
function checkout(manager: string | null, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'jsi-selector-'));
  roots.push(root);
  mkdirSync(join(root, 'node_modules'));
  if (manager !== null) write(root, MANAGER, manager);
  for (const [file, source] of Object.entries(files)) write(root, file, source);
  return root;
}

function guard(root: string) {
  return spawnSync(process.execPath, [GUARD, '--root', root], {
    encoding: 'utf8',
    env: gitFreeEnv(),
  });
}

it('refuses the shipped nitro module under the installed React Native, and passes it patched', () => {
  const pod = 'node_modules/react-native-nitro-modules/NitroModules.podspec';
  const source = `node_modules/react-native-nitro-modules/${nitro.FILE}`;

  const shipped = guard(checkout(installedManager, { [pod]: '', [source]: shippedNitro }));
  expect(shipped.status).toBe(1);
  expect(shipped.stderr).toContain('NativeNitroModules+NewArch.mm');
  expect(shipped.stderr).toContain('installJSIBindingsWithRuntime:');
  expect(shipped.stderr).toContain('installJSIBindingsWithRuntime:callInvoker:');

  const patched = nitro.patchSource(shippedNitro);
  const fixed = guard(checkout(installedManager, { [pod]: '', [source]: patched }));
  expect(fixed.stderr).toBe('');
  expect(fixed.status).toBe(0);
});

it('refuses a scoped package and a local module answering only the old selector', () => {
  const root = checkout(installedManager, {
    'node_modules/@fixture/bindings/ios/FixtureBindings.podspec': '',
    'node_modules/@fixture/bindings/ios/FixtureBindings.mm': OLD_ONLY,
    'modules/fixture-local/ios/LocalBindings.podspec': '',
    'modules/fixture-local/ios/LocalBindings.mm': OLD_ONLY,
  });

  const result = guard(root);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain(join('@fixture', 'bindings', 'ios', 'FixtureBindings.mm'));
  expect(result.stderr).toContain(join('fixture-local', 'ios', 'LocalBindings.mm'));
});

it('passes a module answering the called selector beside the old one', () => {
  const both = CURRENT.replace('@end', OLD_ONLY.split('\n').slice(1, 5).join('\n') + '\n@end');
  const root = checkout(installedManager, {
    'node_modules/fixture-bindings/FixtureBindings.podspec': '',
    'node_modules/fixture-bindings/apple/FixtureBindings.mm': both,
    'node_modules/fixture-current/FixtureCurrent.podspec': '',
    'node_modules/fixture-current/apple/FixtureCurrent.mm': CURRENT,
  });

  const result = guard(root);

  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
});

it('reads a package with no podspec as no iOS module', () => {
  const root = checkout(installedManager, {
    'node_modules/fixture-docs/samples/FixtureBindings.mm': OLD_ONLY,
  });

  expect(guard(root).status).toBe(0);
});

it('stays quiet with no React Native installed', () => {
  const root = checkout(null, {
    'node_modules/fixture-bindings/FixtureBindings.podspec': '',
    'node_modules/fixture-bindings/ios/FixtureBindings.mm': OLD_ONLY,
  });

  expect(guard(root).status).toBe(0);
});

it('refuses a React Native whose caller names no JSI-bindings selector', () => {
  const root = checkout('// the module manager, rewritten upstream\n', {});
  write(root, 'node_modules/react-native/package.json', '{}');

  const result = guard(root);

  expect(result.status).toBe(1);
  expect(result.stderr).toContain('RCTTurboModuleManager.mm');
});
