/**
 * Scenario: Material's Android sheet behaviour looks for the view it hands drags to, the first
 * one depth first that scrolls nested, only when the sheet is laid out. A card pushed into a map
 * sheet, a pager page changed inside one, or a body mounted after a loading state lays the sheet
 * out again on no path, so the sheet keeps the view it found before: a covered card moved out of
 * view, or one already unmounted. Every drag then lands outside that view, the sheet takes it, and
 * at its top stop the card on show cannot be scrolled at all.
 *
 * Expected behaviour: the install-time patch makes the sheet's layout find that view again as
 * each touch starts, applies once, changes nothing on a second run, and refuses a package version
 * or source it was not written against.
 */
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const {
  patchSource,
  unpatchSource,
  applyPatch,
  FILE,
  FINDER_FILE,
  FINDER_SOURCE,
  VERSION,
} = require('../../../scripts/patch-screens-sheet-scroll');

const projectRoot = join(__dirname, '../../..');
const installed = readFileSync(
  join(projectRoot, 'node_modules/react-native-screens', FILE),
  'utf8'
);
/** The sheet's layout as the pinned package ships it, whether or not this install was patched. */
const shipped: string = unpatchSource(installed);

function fixture(version: string = VERSION, source: string = shipped): string {
  const root = mkdtempSync(join(tmpdir(), 'screens-sheet-scroll-'));
  const entry = join(root, 'node_modules/react-native-screens');
  mkdirSync(join(entry, FILE, '..'), { recursive: true });
  writeFileSync(join(entry, 'package.json'), JSON.stringify({ version }));
  writeFileSync(join(entry, FILE), source);
  return root;
}

const read = (root: string, file: string = FILE) =>
  readFileSync(join(root, 'node_modules/react-native-screens', file), 'utf8');
const finderAt = (root: string) => join(root, 'node_modules/react-native-screens', FINDER_FILE);

it('patches the installed package once and a second install changes nothing', () => {
  const root = fixture();
  try {
    expect(() => applyPatch(root, true)).toThrow('sheet scroll patch is missing');

    applyPatch(root);
    const first = read(root);
    expect(first).toBe(patchSource(shipped));
    expect(readFileSync(finderAt(root), 'utf8')).toBe(FINDER_SOURCE);
    expect(() => applyPatch(root, true)).not.toThrow();

    applyPatch(root);
    expect(read(root)).toBe(first);
    expect(readFileSync(finderAt(root), 'utf8')).toBe(FINDER_SOURCE);
    expect(patchSource(first)).toBe(first);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('refuses a patched layout whose finder was removed, and restores it on install', () => {
  const root = fixture();
  try {
    applyPatch(root);
    rmSync(finderAt(root));

    expect(() => applyPatch(root, true)).toThrow('sheet scroll patch is missing');
    applyPatch(root);
    expect(readFileSync(finderAt(root), 'utf8')).toBe(FINDER_SOURCE);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('refuses another package version and writes nothing', () => {
  const root = fixture('4.29.0');
  try {
    expect(() => applyPatch(root)).toThrow(VERSION);
    expect(read(root)).toBe(shipped);
    expect(existsSync(finderAt(root))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('refuses a source whose hash differs, even with the anchor intact', () => {
  const drifted = shipped.replace('super.onLayout(changed', 'super.onLayout( changed');
  const root = fixture(VERSION, drifted);
  try {
    expect(() => applyPatch(root)).toThrow('source changed');
    expect(() => applyPatch(root, true)).toThrow('source changed');
    expect(read(root)).toBe(drifted);
    expect(existsSync(finderAt(root))).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
