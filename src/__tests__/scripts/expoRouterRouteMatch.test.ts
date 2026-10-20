/**
 * Scenario: expo-router takes a route open as a link's target when the two share a name and, for
 * a dynamic route, its parameter, and it finds the parameter only in a name that is one dynamic
 * segment. A detail route named across a directory, `activity/[id]`, then matches whatever its
 * id, and a second activity opens inside the first.
 *
 * Expected behaviour: the install-time patch compares the two routes by name with every dynamic
 * segment filled from their params, applies once, changes nothing on a second run, copies a
 * linked package rather than writing through it, and refuses a version or source it was not
 * written against.
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
} = require('../../../scripts/patch-expo-router-route-match');

const projectRoot = join(__dirname, '../../..');
const installed = readFileSync(join(projectRoot, 'node_modules/expo-router', FILE), 'utf8');
/** The resolver as the pinned package ships it, whether or not this install was patched. */
const shipped: string = unpatchSource(installed);

function packageAt(dir: string, version: string, source: string): void {
  mkdirSync(join(dir, FILE, '..'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ version }));
  writeFileSync(join(dir, FILE), source);
}

function fixture(version: string = VERSION, source: string = shipped): string {
  const root = mkdtempSync(join(tmpdir(), 'router-route-match-'));
  packageAt(join(root, 'node_modules/expo-router'), version, source);
  return root;
}

const read = (root: string) => readFileSync(join(root, 'node_modules/expo-router', FILE), 'utf8');

/** The patched source's `routesMatch`, loaded on its own with the singular id it calls. */
function routesMatchOf(source: string) {
  const at = source.indexOf('function routesMatch(');
  const end = source.indexOf('\n}\n', at) + 2;
  const { getSingularId } = require('expo-router/build/utils/getSingularId');
  const { matchDynamicName } = require('expo-router/build/matchers');
  return new Function(
    '_getSingularId',
    '_matchers',
    `${source.slice(at, end)}; return routesMatch;`
  )({ getSingularId }, { matchDynamicName }) as (
    target: { name: string; params?: object },
    current: { name: string; params?: object }
  ) => boolean;
}

it('tells two subjects of a route named across a directory apart, and keeps one subject one', () => {
  const before = routesMatchOf(shipped);
  const after = routesMatchOf(patchSource(shipped));
  const larch = { name: 'trail/[id]', params: { id: 'larch' } };
  const spruce = { name: 'trail/[id]', params: { id: 'spruce' } };

  expect(before(spruce, larch)).toBe(true);
  expect(after(spruce, larch)).toBe(false);
  expect(after({ ...larch, params: { id: 'larch' } }, larch)).toBe(true);
  expect(after({ name: '[id]', params: { id: 'a' } }, { name: '[id]', params: { id: 'b' } })).toBe(
    false
  );
  expect(after({ name: 'about' }, { name: 'about' })).toBe(true);
  expect(after({ name: 'about' }, { name: 'trail/[id]' })).toBe(false);
  expect(unpatchSource(patchSource(shipped))).toBe(shipped);
});

it('patches the installed package once and a second install changes nothing', () => {
  const root = fixture();
  try {
    expect(() => applyPatch(root, true)).toThrow('route match patch is missing');

    applyPatch(root);
    const first = read(root);
    expect(first).toBe(patchSource(shipped));
    expect(() => applyPatch(root, true)).not.toThrow();

    applyPatch(root);
    expect(read(root)).toBe(first);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('copies a linked package into the tree before patching, leaving the linked one as it ships', () => {
  const shared = mkdtempSync(join(tmpdir(), 'router-route-match-shared-'));
  const root = mkdtempSync(join(tmpdir(), 'router-route-match-tree-'));
  try {
    packageAt(shared, VERSION, shipped);
    mkdirSync(join(root, 'node_modules'));
    symlinkSync(shared, join(root, 'node_modules/expo-router'));

    applyPatch(root);

    expect(lstatSync(join(root, 'node_modules/expo-router')).isSymbolicLink()).toBe(false);
    expect(read(root)).toBe(patchSource(shipped));
    expect(readFileSync(join(shared, FILE), 'utf8')).toBe(shipped);
  } finally {
    rmSync(shared, { recursive: true, force: true });
    rmSync(root, { recursive: true, force: true });
  }
});

it('refuses a version or a source it was not written against', () => {
  for (const root of [fixture('58.1.0'), fixture(VERSION, `${shipped}\n// changed\n`)]) {
    try {
      expect(() => applyPatch(root)).toThrow(/requires version|source changed/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});
