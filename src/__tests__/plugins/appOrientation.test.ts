/**
 * Scenario: the app is laid out for portrait only, apart from the full-screen
 * chart, which locks landscape at runtime.
 *
 * Expected behaviour: `app.json` pins portrait on both platforms. The
 * `orientation` key alone is enough for Android, where the config plugin writes
 * `android:screenOrientation`, but iOS reads
 * `EXDefaultScreenOrientationMask` from the `expo-screen-orientation` plugin
 * ahead of `UISupportedInterfaceOrientations`, so that key has to move with it.
 * Either one drifting back on its own leaves a platform rotating.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

type PluginEntry = string | [string, Record<string, unknown>];

const appConfig = JSON.parse(readFileSync(join(__dirname, '../../../app.json'), 'utf8')) as {
  expo: { orientation: string; plugins: PluginEntry[] };
};

function pluginConfig(name: string): Record<string, unknown> | undefined {
  const entry = appConfig.expo.plugins.find(
    (plugin) => Array.isArray(plugin) && plugin[0] === name
  );
  return Array.isArray(entry) ? entry[1] : undefined;
}

describe('app.json orientation', () => {
  it('pins portrait for Android and the Info.plist orientations', () => {
    expect(appConfig.expo.orientation).toBe('portrait');
  });

  it('pins portrait for the iOS default orientation mask', () => {
    expect(pluginConfig('expo-screen-orientation')).toEqual({
      initialOrientation: 'PORTRAIT_UP',
    });
  });

  it('carries both keys into the checked-in Info.plist', () => {
    const plist = readFileSync(join(__dirname, '../../../ios/VeloqDev/Info.plist'), 'utf8');
    expect(plist).toContain(
      '<key>EXDefaultScreenOrientationMask</key>\n    <string>UIInterfaceOrientationMaskPortrait</string>'
    );
    expect(plist).not.toContain('UIInterfaceOrientationLandscape');
  });

  it('keeps the tablet target working rather than dropping it', () => {
    const ios = (appConfig.expo as unknown as { ios: Record<string, unknown> }).ios;
    expect(ios.supportsTablet).toBe(true);
  });
});
