/**
 * Scenario: react-native-screens makes every Android form sheet hideable, so a
 * drag below a sheet's lowest detent dismisses its route even when the route
 * sets `gestureEnabled: false`, which keeps the sheet on screen on iOS.
 *
 * Expected behaviour: the install-time patch makes the Android sheet hideable
 * only while its screen allows the dismiss gesture, applies once, changes
 * nothing on a second run, and refuses a package version or source it was not
 * written against.
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  patchSource,
  unpatchSource,
  applyPatch,
  FILE,
  VERSION,
} = require('../../../scripts/patch-screens-sheet-hide');

const projectRoot = join(__dirname, '../../..');
const installed = readFileSync(
  join(projectRoot, 'node_modules/react-native-screens', FILE),
  'utf8'
);
/** The delegate as the pinned package ships it, whether or not this install was patched. */
const shipped: string = unpatchSource(installed);

function fixture(version: string = VERSION, source: string = shipped): string {
  const root = mkdtempSync(join(tmpdir(), 'screens-sheet-hide-'));
  const entry = join(root, 'node_modules/react-native-screens');
  mkdirSync(join(entry, FILE, '..'), { recursive: true });
  writeFileSync(join(entry, 'package.json'), JSON.stringify({ version }));
  writeFileSync(join(entry, FILE), source);
  return root;
}

const read = (root: string) =>
  readFileSync(join(root, 'node_modules/react-native-screens', FILE), 'utf8');

it('hides the sheet by drag only while its screen allows the dismiss gesture', () => {
  const patched = patchSource(shipped);

  expect(shipped).toMatch(/isHideable = true\n/);
  expect(patched).toMatch(/isHideable = screen\.isGestureEnabled\n\s*isDraggable = true/);
  expect(patched).not.toMatch(/isHideable = true\n/);
  expect(unpatchSource(patched)).toBe(shipped);
});

it('patches the installed package once and a second install changes nothing', () => {
  const root = fixture();
  try {
    expect(() => applyPatch(root, true)).toThrow('sheet hide patch is missing');

    applyPatch(root);
    const first = read(root);
    expect(first).toBe(patchSource(shipped));
    expect(() => applyPatch(root, true)).not.toThrow();

    applyPatch(root);
    expect(read(root)).toBe(first);
    expect(patchSource(first)).toBe(first);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('refuses another package version and leaves the file as it was', () => {
  const root = fixture('4.29.0');
  try {
    expect(() => applyPatch(root)).toThrow(VERSION);
    expect(read(root)).toBe(shipped);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('refuses a source whose hash differs, even with the anchor intact', () => {
  const drifted = shipped.replace('isDraggable = true', 'isDraggable  = true');
  const root = fixture(VERSION, drifted);
  try {
    expect(() => applyPatch(root)).toThrow('source changed');
    expect(() => applyPatch(root, true)).toThrow('source changed');
    expect(read(root)).toBe(drifted);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
