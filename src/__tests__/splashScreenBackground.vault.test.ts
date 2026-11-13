/**
 * Scenario: the app cold starts, in light or dark mode, on Android or iOS.
 *
 * Expected behaviour: the splash fills the screen with the brand blue the launcher icon sits on,
 * in both appearances and on both platforms. The splash plugin writes nothing when it is listed
 * without options, which leaves the generated Android project on its white default, so the
 * colours are read from what the plugin itself generates from the resolved app config.
 */

import os from 'os';
import path from 'path';

const { getConfig } = require('expo/config');
const { compileModsAsync } = require('expo/config-plugins');
const withSplashScreen = require('expo-splash-screen/app.plugin.js').default;
// The plugin's own reading of its options for iOS, which the launch storyboard's colour set is
// written from. The package does not export it, so it is reached by path.
const pluginRoot = path.dirname(require.resolve('expo-splash-screen/package.json'));
const { getIosSplashConfig } = require(path.join(pluginRoot, 'plugin/build/getIosSplashConfig'));

const projectRoot = path.join(__dirname, '../..');
const PLUGIN = 'expo-splash-screen';

type ColorEntry = { $: { name: string }; _: string };
type ColorsXml = { resources: { color?: ColorEntry[] } };

function resolved() {
  return getConfig(projectRoot, { skipSDKVersionRequirement: true }).exp;
}

function splashProps(): Record<string, unknown> | undefined {
  const entry = resolved().plugins.find(
    (plugin: unknown) => (Array.isArray(plugin) ? plugin[0] : plugin) === PLUGIN
  );
  expect(entry).toBeDefined();
  return Array.isArray(entry) ? entry[1] : undefined;
}

function brandBlue(): string {
  return resolved().android.adaptiveIcon.backgroundColor;
}

async function androidColors(): Promise<{ day: ColorsXml; night: ColorsXml }> {
  const root = path.join(os.tmpdir(), 'splash-introspect');
  const base = { name: 'Splash', slug: 'splash', _internal: { projectRoot: root } };
  const config = withSplashScreen(base, splashProps());
  const compiled = await compileModsAsync(config, {
    projectRoot: root,
    platforms: ['android'],
    introspect: true,
  });
  const results = compiled._internal.modResults.android;
  return { day: results.colors, night: results.colorsNight };
}

function splashColor(xml: ColorsXml): string | undefined {
  return xml.resources.color?.find((c) => c.$.name === 'splashscreen_background')?._;
}

describe('the splash background', () => {
  it('is the brand blue the launcher icon sits on', () => {
    expect(brandBlue()).toBe('#2F6699');
  });

  it('is generated into the Android colours for light mode', async () => {
    const { day } = await androidColors();
    expect(splashColor(day)?.toUpperCase()).toBe(brandBlue());
  });

  it('is generated into the Android night colours for dark mode', async () => {
    const { night } = await androidColors();
    expect(splashColor(night)?.toUpperCase()).toBe(brandBlue());
  });

  it('is the colour the iOS launch storyboard is drawn on, light and dark', () => {
    const props = splashProps();
    expect(props).toBeDefined();
    const ios = getIosSplashConfig(props);
    expect(ios.backgroundColor.toUpperCase()).toBe(brandBlue());
    expect(ios.dark.backgroundColor?.toUpperCase()).toBe(brandBlue());
  });

  it('draws the wordmark rather than leaving the background empty', () => {
    const props = splashProps();
    expect(props?.image).toBe('./src/assets/splash-icon.png');
  });

  it('has one owner, the plugin, rather than a second top-level block', () => {
    expect(resolved().splash).toBeUndefined();
  });
});
