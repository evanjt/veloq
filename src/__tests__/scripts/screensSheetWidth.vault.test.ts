/**
 * Scenario: react-native-screens builds an Android form sheet's behaviour with
 * Material's no-argument constructor, which carries no maximum width, and lays
 * the sheet out at the left edge. On a tablet every sheet then spans the
 * window.
 *
 * Expected behaviour: the install-time patch caps the sheet at Material's
 * 640 dp and centres it, applies once, changes nothing on a second run, and
 * refuses a package version or source it was not written against.
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
} = require('../../../scripts/patch-screens-sheet-width');

const projectRoot = join(__dirname, '../../..');
const installed = readFileSync(
  join(projectRoot, 'node_modules/react-native-screens', FILE),
  'utf8'
);
/** The fragment as the pinned package ships it, whether or not this install was patched. */
const shipped: string = unpatchSource(installed);

function fixture(version: string = VERSION, source: string = shipped): string {
  const root = mkdtempSync(join(tmpdir(), 'screens-sheet-width-'));
  const entry = join(root, 'node_modules/react-native-screens');
  mkdirSync(join(entry, FILE, '..'), { recursive: true });
  writeFileSync(join(entry, 'package.json'), JSON.stringify({ version }));
  writeFileSync(join(entry, FILE), source);
  return root;
}

const read = (root: string) =>
  readFileSync(join(root, 'node_modules/react-native-screens', FILE), 'utf8');

it('caps the sheet behaviour at 640 dp and centres the sheet horizontally', () => {
  const patched = patchSource(shipped);

  expect(patched).toContain('import android.view.Gravity\n');
  expect(patched).toContain('maxWidth = PixelUtil.toPixelFromDIP(640f).toInt()');
  expect(patched).toMatch(
    /if \(screen\.usesFormSheetPresentation\(\)\) \{\s*gravity = Gravity\.CENTER_HORIZONTAL/
  );
  expect(patched).not.toMatch(/<Screen> = BottomSheet\w+<Screen>\(\)\n/);
  expect(unpatchSource(patched)).toBe(shipped);
});

it('patches the installed package once and a second install changes nothing', () => {
  const root = fixture();
  try {
    expect(() => applyPatch(root, true)).toThrow('sheet width patch is missing');

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

it('refuses a source whose hash differs, even with every anchor intact', () => {
  const drifted = shipped.replace('class ScreenStackFragment :', 'class ScreenStackFragment  :');
  const root = fixture(VERSION, drifted);
  try {
    expect(() => applyPatch(root)).toThrow('source changed');
    expect(() => applyPatch(root, true)).toThrow('source changed');
    expect(read(root)).toBe(drifted);
    expect(() => patchSource(patchSource(shipped).replace('640f', '600f'))).toThrow(
      'source changed'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
