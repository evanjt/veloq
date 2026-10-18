/**
 * Scenario: React Native 0.87 and later install a TurboModule's JSI bindings only through
 * `installJSIBindingsWithRuntime:callInvoker:`. The pinned nitro-modules implements the
 * one-argument selector alone, so on iOS nothing installs `NitroModulesProxy` and the app
 * aborts at launch with "installJSIBindingsWithRuntime: was not called".
 *
 * Expected behaviour: the install-time patch gives the nitro TurboModule the selector the
 * installed React Native calls, caching the invoker it is handed, applies once, changes
 * nothing on a second run, and refuses a package version or source it was not written
 * against. A whole `node_modules` linked to another checkout is not written through.
 */
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  patchSource,
  unpatchSource,
  applyPatch,
  FILE,
  VERSION,
} = require('../../../scripts/patch-nitro-jsi-install');

const projectRoot = join(__dirname, '../../..');
const installed = readFileSync(
  join(projectRoot, 'node_modules/react-native-nitro-modules', FILE),
  'utf8'
);
/** The TurboModule as the pinned package ships it, whether or not this install was patched. */
const shipped: string = unpatchSource(installed);

/** The JSI-bindings selectors the installed React Native asks a TurboModule for. */
const called = [
  ...readFileSync(
    join(
      projectRoot,
      'node_modules/react-native/ReactCommon/react/nativemodule/core/platform/ios/ReactCommon/RCTTurboModuleManager.mm'
    ),
    'utf8'
  ).matchAll(/@selector\((installJSIBindingsWithRuntime[\w:]*)\)/g),
].map((match) => match[1]);

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function fixture(version: string = VERSION, source: string = shipped): string {
  const root = mkdtempSync(join(tmpdir(), 'nitro-jsi-install-'));
  dirs.push(root);
  const entry = join(root, 'node_modules/react-native-nitro-modules');
  mkdirSync(join(entry, FILE, '..'), { recursive: true });
  writeFileSync(join(entry, 'package.json'), JSON.stringify({ version }));
  writeFileSync(join(entry, FILE), source);
  return root;
}

const read = (root: string) =>
  readFileSync(join(root, 'node_modules/react-native-nitro-modules', FILE), 'utf8');

it('answers the selector the installed React Native calls, which the shipped source does not', () => {
  const patched = patchSource(shipped);

  expect(called).toEqual(['installJSIBindingsWithRuntime:callInvoker:']);
  expect(shipped).not.toMatch(
    /installJSIBindingsWithRuntime:\(jsi::Runtime&\)runtime callInvoker:/
  );
  expect(patched).toMatch(
    /- \(void\)installJSIBindingsWithRuntime:\(jsi::Runtime&\)runtime\s+callInvoker:\(const std::shared_ptr<react::CallInvoker>&\)callInvoker \{\n\s+_callInvoker = callInvoker;\n\s+\[self installNitroInRuntime:runtime\];/
  );
  expect(patched).toMatch(/- \(void\)installNitroInRuntime:\(jsi::Runtime&\)runtime \{/);
  expect(unpatchSource(patched)).toBe(shipped);
});

it('patches the installed package once and a second install changes nothing', () => {
  const root = fixture();
  expect(() => applyPatch(root, true)).toThrow('JSI install patch is missing');

  applyPatch(root);
  const first = read(root);
  expect(first).toBe(patchSource(shipped));
  expect(() => applyPatch(root, true)).not.toThrow();

  applyPatch(root);
  expect(read(root)).toBe(first);
  expect(patchSource(first)).toBe(first);
});

it('refuses another package version and leaves the file as it was', () => {
  const root = fixture('0.36.5');
  expect(() => applyPatch(root)).toThrow(VERSION);
  expect(read(root)).toBe(shipped);
});

it('refuses a source whose hash differs, even with the anchor intact', () => {
  const drifted = shipped.replace('bool _didInstall;', 'bool  _didInstall;');
  const root = fixture(VERSION, drifted);
  expect(() => applyPatch(root)).toThrow('source changed');
  expect(() => applyPatch(root, true)).toThrow('source changed');
  expect(read(root)).toBe(drifted);
});

it('copies a package linked from another checkout rather than writing through the link', () => {
  const main = fixture();
  const tree = mkdtempSync(join(tmpdir(), 'nitro-jsi-tree-'));
  dirs.push(tree);
  mkdirSync(join(tree, 'node_modules'));
  symlinkSync(
    join(main, 'node_modules/react-native-nitro-modules'),
    join(tree, 'node_modules/react-native-nitro-modules')
  );

  applyPatch(tree);

  expect(lstatSync(join(tree, 'node_modules/react-native-nitro-modules')).isSymbolicLink()).toBe(
    false
  );
  expect(read(tree)).toBe(patchSource(shipped));
  expect(read(main)).toBe(shipped);
});

it('refuses to write through a whole node_modules linked to another checkout', () => {
  const main = fixture();
  const tree = mkdtempSync(join(tmpdir(), 'nitro-jsi-tree-'));
  dirs.push(tree);
  symlinkSync(join(main, 'node_modules'), join(tree, 'node_modules'));

  expect(() => applyPatch(tree)).toThrow('shared node_modules link');
  expect(read(main)).toBe(shipped);
});
