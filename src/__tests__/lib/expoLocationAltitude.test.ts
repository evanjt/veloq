import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const { patchAltitude, applyPatch } = require('../../../scripts/patch-expo-location');

it('preserves Android altitude validity and is idempotent', () => {
  const patched = patchAltitude('altitude = location.altitude,');
  expect(patched).toContain('if (location.hasAltitude()) location.altitude else null');
  expect(patchAltitude(patched)).toBe(patched);
});

it('refuses an upstream constructor it cannot patch', () => {
  expect(() => patchAltitude('altitude = otherAltitude,')).toThrow();
});

it('copies a linked package before patching and preserves the shared source', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'location-altitude-'));
  try {
    const shared = path.join(root, 'shared');
    const tree = path.join(root, 'tree');
    const relative = 'android/src/main/java/expo/modules/location/records/LocationResults.kt';
    fs.mkdirSync(path.dirname(path.join(shared, relative)), { recursive: true });
    fs.writeFileSync(path.join(shared, relative), 'altitude = location.altitude,');
    fs.mkdirSync(path.join(tree, 'node_modules'), { recursive: true });
    fs.symlinkSync(shared, path.join(tree, 'node_modules/expo-location'));
    applyPatch(tree);
    applyPatch(tree);
    expect(fs.readFileSync(path.join(shared, relative), 'utf8')).toBe(
      'altitude = location.altitude,'
    );
    expect(fs.lstatSync(path.join(tree, 'node_modules/expo-location')).isSymbolicLink()).toBe(
      false
    );
    expect(
      fs.readFileSync(path.join(tree, 'node_modules/expo-location', relative), 'utf8')
    ).toContain('location.hasAltitude()');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
