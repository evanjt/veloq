/**
 * Scenario: an athlete on Android 12 or later refuses location and scans for a heart rate strap,
 * or a phone without Bluetooth LE looks the app up in the store.
 *
 * Expected behaviour: the manifest prebuild generates says the scan never derives location, so
 * the platform returns results without a location grant; the legacy Bluetooth permissions stop at
 * Android 11, where the runtime permissions replace them; Bluetooth hardware is optional, so the
 * listing reaches a phone without it; and the location grant recording uses is declared with no
 * cap on any API level.
 */

import path from 'path';

const projectRoot = path.join(__dirname, '../../..');

type Entry = { $: Record<string, string> };
type Manifest = {
  manifest: {
    'uses-permission'?: Entry[];
    'uses-permission-sdk-23'?: Entry[];
    'uses-feature'?: Entry[];
  };
};

/** The AndroidManifest prebuild generates from the real config, read without writing `android/`. */
async function generatedManifest(): Promise<Manifest> {
  const expo = require.resolve('expo/package.json', { paths: [projectRoot] });
  const { getPrebuildConfigAsync } = require(
    require.resolve('@expo/prebuild-config', { paths: [expo] })
  );
  const { compileModsAsync } = require('expo/config-plugins');
  const { exp } = await getPrebuildConfigAsync(projectRoot, { platforms: ['android'] });
  const compiled = await compileModsAsync(exp, {
    projectRoot,
    introspect: true,
    platforms: ['android'],
    assertMissingModProviders: false,
  });
  return compiled._internal.modResults.android.manifest;
}

const named = (entries: Entry[] | undefined, name: string): Entry[] =>
  (entries ?? []).filter((entry) => entry.$['android:name'] === name);

describe('the generated Android Bluetooth declarations', () => {
  let manifest: Manifest;
  beforeAll(async () => {
    manifest = await generatedManifest();
  }, 60_000);

  it('declares that a Bluetooth scan never derives location', () => {
    const scan = named(manifest.manifest['uses-permission'], 'android.permission.BLUETOOTH_SCAN');
    expect(scan).toHaveLength(1);
    expect(scan[0]!.$['android:usesPermissionFlags']).toBe('neverForLocation');
  });

  it.each(['android.permission.BLUETOOTH', 'android.permission.BLUETOOTH_ADMIN'])(
    'stops %s at Android 11',
    (name) => {
      const declared = named(manifest.manifest['uses-permission'], name);
      expect(declared).toHaveLength(1);
      expect(declared[0]!.$['android:maxSdkVersion']).toBe('30');
    }
  );

  it('keeps the runtime Bluetooth connect permission for Android 12 and later', () => {
    const connect = named(
      manifest.manifest['uses-permission'],
      'android.permission.BLUETOOTH_CONNECT'
    );
    expect(connect).toHaveLength(1);
    expect(connect[0]!.$['android:maxSdkVersion']).toBeUndefined();
  });

  it.each(['android.hardware.bluetooth_le', 'android.hardware.bluetooth'])(
    'declares %s optional, so a phone without it still installs the app',
    (name) => {
      const features = named(manifest.manifest['uses-feature'], name);
      expect(features).toHaveLength(1);
      expect(features[0]!.$['android:required']).toBe('false');
    }
  );

  it('requires no hardware feature at all', () => {
    const required = (manifest.manifest['uses-feature'] ?? []).filter(
      (feature) => feature.$['android:required'] !== 'false'
    );
    expect(required).toEqual([]);
  });

  it.each(['android.permission.ACCESS_FINE_LOCATION', 'android.permission.ACCESS_COARSE_LOCATION'])(
    'declares %s for recording with no cap on any API level',
    (name) => {
      const plain = named(manifest.manifest['uses-permission'], name);
      expect(plain).toHaveLength(1);
      const everywhere = [...plain, ...named(manifest.manifest['uses-permission-sdk-23'], name)];
      for (const declared of everywhere) {
        expect(declared.$['android:maxSdkVersion']).toBeUndefined();
      }
    }
  );
});

describe('regenerating over a manifest an earlier prebuild left behind', () => {
  const { configureManifest } = require('../../plugins/with-android-bluetooth');

  /** What the BLE plugin leaves when the manifest already holds a scan permission without the flag. */
  function staleManifest() {
    return {
      manifest: {
        $: { 'xmlns:tools': 'http://schemas.android.com/tools' },
        'uses-permission': [
          { $: { 'android:name': 'android.permission.BLUETOOTH' } },
          { $: { 'android:name': 'android.permission.BLUETOOTH_SCAN', 'tools:targetApi': '31' } },
          { $: { 'android:name': 'android.permission.ACCESS_FINE_LOCATION' } },
        ],
        'uses-permission-sdk-23': [
          { $: { 'android:name': 'android.permission.ACCESS_FINE_LOCATION' } },
        ],
        'uses-feature': [
          { $: { 'android:name': 'android.hardware.bluetooth_le', 'android:required': 'true' } },
        ],
      },
    };
  }

  it('flags the scan permission it finds as never deriving location', () => {
    const { manifest } = configureManifest(staleManifest());
    const scan = named(manifest['uses-permission'], 'android.permission.BLUETOOTH_SCAN');
    expect(scan).toHaveLength(1);
    expect(scan[0]!.$['android:usesPermissionFlags']).toBe('neverForLocation');
    expect(scan[0]!.$['tools:targetApi']).toBe('31');
  });

  it('gives the same manifest when run a second time', () => {
    const once = configureManifest(staleManifest());
    const twice = configureManifest(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });
});
