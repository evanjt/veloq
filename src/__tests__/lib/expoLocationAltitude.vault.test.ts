/**
 * Scenario: Android reports a fix's altitude above the WGS84 ellipsoid and iOS
 * above mean sea level, so an Android recording sat tens of metres above every
 * other source for the same ground. The patch to expo-location gives each fix
 * its sea-level altitude before it is mapped for JavaScript.
 *
 * Expected behaviour: both altitude mappings read the sea-level altitude and
 * never the raw one, the watched and background fixes are converted before
 * they are mapped, the converter is a dependency, and a copy carrying the
 * earlier validity-only patch is brought forward.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import {
  FILES,
  GUARDED_RESULTS,
  UPSTREAM,
  writeExpoLocation,
} from '../__shared__/expoLocationFixture';

const { applyPatch, locationState } = require('../../../scripts/patch-expo-location');

const HELPER_SOURCE = path.join(__dirname, '../../../scripts/expo-location/SeaLevelAltitude.kt');

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

function tree(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'location-altitude-'));
  roots.push(root);
  return root;
}

/** A tree with expo-location as given, patched, and its package directory. */
function patched(overrides = {}): string {
  const root = tree();
  const pkg = writeExpoLocation(root, overrides);
  applyPatch(root);
  return pkg;
}

const read = (pkg: string, key: keyof typeof FILES) =>
  fs.readFileSync(path.join(pkg, FILES[key]), 'utf8');

describe('the expo-location altitude patch', () => {
  it('maps both altitude readings from sea level, never the raw ellipsoidal height', () => {
    const results = read(patched(), 'results');

    expect(results).toContain('    altitude = SeaLevelAltitude.of(location),\n');
    expect(results).toContain('          altitude = SeaLevelAltitude.of(location)\n');
    expect(results).not.toContain('location.altitude');
  });

  it('converts a watched fix before it is mapped', () => {
    const module = read(patched(), 'module');

    expect(module).toContain(
      'SeaLevelAltitude.add(mContext, listOf(location)) { callbacks.onLocationChanged(location) }'
    );
    expect(module.match(/onLocationChanged\(location\)/g)).toHaveLength(1);
  });

  it('converts background fixes before the task maps them, and drops them once it stops', () => {
    const tasks = read(patched(), 'tasks');

    expect(tasks).toContain(
      'SeaLevelAltitude.add(context, result.locations) { if (mTask != null) handleLocationUpdate(it) }'
    );
    expect(tasks).toContain(
      'SeaLevelAltitude.add(context, listOf(it)) { fixes -> if (mTask != null) handleLocationUpdate(fixes) }'
    );
    expect(tasks.match(/handleLocationUpdate\(/g)).toHaveLength(2);
  });

  it('depends on the converter and installs the helper that calls it', () => {
    const pkg = patched();

    expect(read(pkg, 'gradle')).toContain(
      "  implementation 'androidx.core:core-location-altitude:1.0.0'\n"
    );
    expect(read(pkg, 'helper')).toBe(fs.readFileSync(HELPER_SOURCE, 'utf8'));
  });

  it('brings forward a copy the validity-only patch left', () => {
    const results = read(patched({ results: GUARDED_RESULTS }), 'results');

    expect(results).toContain('    altitude = SeaLevelAltitude.of(location),\n');
    expect(results).not.toContain('location.altitude');
  });

  it('is idempotent', () => {
    const root = tree();
    const pkg = writeExpoLocation(root);
    applyPatch(root);
    const once = Object.keys(FILES).map((key) => read(pkg, key as keyof typeof FILES));
    applyPatch(root);

    expect(Object.keys(FILES).map((key) => read(pkg, key as keyof typeof FILES))).toEqual(once);
    expect(locationState(pkg).state).toBe('patched');
  });

  it.each(Object.keys(UPSTREAM))('refuses %s when the line it rewrites changed upstream', (key) => {
    const root = tree();
    writeExpoLocation(root, { [key]: '// rewritten upstream\n' });

    expect(() => applyPatch(root)).toThrow(/expo-location changed/);
  });

  it('copies a linked package before patching and preserves the shared source', () => {
    const root = tree();
    const shared = path.dirname(writeExpoLocation(path.join(root, 'shared')));
    const dir = path.join(root, 'tree');
    fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
    fs.symlinkSync(
      path.join(shared, 'expo-location'),
      path.join(dir, 'node_modules/expo-location')
    );
    applyPatch(dir);
    applyPatch(dir);

    expect(fs.readFileSync(path.join(shared, 'expo-location', FILES.results), 'utf8')).toBe(
      UPSTREAM.results
    );
    expect(fs.existsSync(path.join(shared, 'expo-location', FILES.helper))).toBe(false);
    expect(fs.lstatSync(path.join(dir, 'node_modules/expo-location')).isSymbolicLink()).toBe(false);
    expect(locationState(path.join(dir, 'node_modules/expo-location')).state).toBe('patched');
  });
});
