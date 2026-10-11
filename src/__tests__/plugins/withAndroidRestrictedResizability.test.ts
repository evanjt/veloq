/**
 * Scenario: the app targets API 36 and runs on a display at least 600 dp wide
 * at its smallest: a tablet, a foldable's inner screen, a desktop window.
 * Android 16 ignores `screenOrientation` there unless the activity opts out.
 *
 * Expected behaviour: the prebuilt manifest gives `MainActivity` the
 * restricted-resizability property, so the portrait lock in `app.json` holds
 * on those displays too.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { AndroidConfig, XML } = require('expo/config-plugins');
const {
  RESTRICTED_RESIZABILITY,
  restrictResizability,
} = require('../../plugins/with-android-restricted-resizability');

const PLUGIN = './src/plugins/with-android-restricted-resizability';

const MANIFEST = `<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application android:name=".MainApplication">
    <activity android:name=".MainActivity" android:screenOrientation="portrait">
      <intent-filter>
        <action android:name="android.intent.action.MAIN" />
        <category android:name="android.intent.category.LAUNCHER" />
      </intent-filter>
    </activity>
    <activity android:name=".OtherActivity" />
  </application>
</manifest>`;

type Element = { $?: Record<string, string>; property?: Element[] };

async function parsedManifest() {
  return XML.parseXMLAsync(MANIFEST);
}

function properties(activity: Element): Record<string, string>[] {
  return (activity.property ?? []).map((item) => item.$ ?? {});
}

describe('with-android-restricted-resizability', () => {
  it('opts MainActivity out of large-screen resizing', async () => {
    const manifest = restrictResizability(await parsedManifest());

    const main = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
    expect(properties(main)).toEqual([
      { 'android:name': RESTRICTED_RESIZABILITY, 'android:value': 'true' },
    ]);
    expect(RESTRICTED_RESIZABILITY).toBe(
      'android.window.PROPERTY_COMPAT_ALLOW_RESTRICTED_RESIZABILITY'
    );
  });

  it('keeps the portrait lock the opt-out exists to deliver', async () => {
    const manifest = restrictResizability(await parsedManifest());

    const main = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
    expect(main.$['android:screenOrientation']).toBe('portrait');
  });

  it('leaves every other activity alone', async () => {
    const manifest = restrictResizability(await parsedManifest());

    const other = manifest.manifest.application[0].activity.find(
      (activity: Element) => activity.$?.['android:name'] === '.OtherActivity'
    );
    expect(other.property).toBeUndefined();
  });

  it('writes the property once however often prebuild runs', async () => {
    const manifest = restrictResizability(restrictResizability(await parsedManifest()));

    const main = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
    expect(properties(main)).toHaveLength(1);
  });

  it('turns a property left false back on', async () => {
    const manifest = await parsedManifest();
    const main = AndroidConfig.Manifest.getMainActivityOrThrow(manifest);
    main.property = [{ $: { 'android:name': RESTRICTED_RESIZABILITY, 'android:value': 'false' } }];

    restrictResizability(manifest);

    expect(properties(main)).toEqual([
      { 'android:name': RESTRICTED_RESIZABILITY, 'android:value': 'true' },
    ]);
  });

  it('is registered in app.json, so prebuild runs it', () => {
    const appConfig = JSON.parse(readFileSync(join(__dirname, '../../../app.json'), 'utf8')) as {
      expo: { plugins: (string | [string, unknown])[] };
    };
    expect(appConfig.expo.plugins).toContain(PLUGIN);
  });
});
