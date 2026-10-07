/**
 * Scenario: the iOS resource bundle is built from `BasemapAssets` in the pod
 * directory. CocoaPods does not follow a symlink there, so a link to the shared
 * asset directory produced a bundle holding only its Info.plist and every
 * sprite and glyph request answered 404.
 * Expected behaviour: the pod directory receives real files, laid out as the
 * shared directory is, and a second run replaces what the first left.
 */

import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../../modules/veloqrs/scripts/sync-basemap-assets.js');
const { syncBasemapAssets } = require(SCRIPT) as {
  syncBasemapAssets: (source: string, destination: string) => void;
};

function listFiles(root: string, prefix = ''): string[] {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap((entry) => {
    const relative = join(prefix, entry.name);
    return entry.isDirectory() ? listFiles(root, relative) : [relative];
  });
}

describe('syncBasemapAssets', () => {
  let dir: string;
  let source: string;
  let destination: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'basemap-sync-'));
    source = join(dir, 'assets', 'basemap');
    destination = join(dir, 'ios', 'BasemapAssets');
    mkdirSync(join(source, 'fonts', 'Stack One'), { recursive: true });
    mkdirSync(join(source, 'sprites', 'set'), { recursive: true });
    writeFileSync(join(source, 'fonts', 'Stack One', '0-255.pbf'), 'glyphs');
    writeFileSync(join(source, 'sprites', 'set', 'atlas.json'), '{}');
    mkdirSync(join(dir, 'ios'));
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('copies the tree as real files', () => {
    syncBasemapAssets(source, destination);

    expect(lstatSync(destination).isSymbolicLink()).toBe(false);
    expect(listFiles(destination).sort()).toEqual(listFiles(source).sort());
    expect(readFileSync(join(destination, 'fonts', 'Stack One', '0-255.pbf'), 'utf8')).toBe(
      'glyphs'
    );
  });

  it('replaces a symlink left by an older checkout', () => {
    symlinkSync(source, destination);

    syncBasemapAssets(source, destination);

    expect(lstatSync(destination).isSymbolicLink()).toBe(false);
    expect(listFiles(destination)).toHaveLength(2);
  });

  it('drops a file the source no longer has and takes a changed one', () => {
    syncBasemapAssets(source, destination);
    rmSync(join(source, 'sprites'), { recursive: true });
    writeFileSync(join(source, 'fonts', 'Stack One', '0-255.pbf'), 'newer');

    syncBasemapAssets(source, destination);

    expect(listFiles(destination)).toEqual([join('fonts', 'Stack One', '0-255.pbf')]);
    expect(readFileSync(join(destination, 'fonts', 'Stack One', '0-255.pbf'), 'utf8')).toBe(
      'newer'
    );
  });

  it('stops when the source is missing and leaves the existing copy', () => {
    syncBasemapAssets(source, destination);
    rmSync(source, { recursive: true });

    expect(() => syncBasemapAssets(source, destination)).toThrow(/basemap/i);
    expect(listFiles(destination)).toHaveLength(2);
  });
});
