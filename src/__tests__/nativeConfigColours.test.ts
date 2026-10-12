/**
 * Scenario: the colours native code draws before any JavaScript runs, the adaptive icon's ground,
 * the splash in light and dark mode and the Android notification accent, are generated from the
 * app config at prebuild.
 *
 * Expected behaviour: each is the token the app renders the same role with, and the app config
 * reads it from the token rather than holding a copy, so a palette change moves the native
 * config with it.
 */

import path from 'path';

const { getConfig } = require('expo/config');

const projectRoot = path.join(__dirname, '../..');
const TOKENS = '../theme/appColours.json';

type PluginProps = {
  backgroundColor?: string;
  color?: string;
  dark?: { backgroundColor?: string };
};
type Plugin = string | [string, PluginProps];
type NativeConfig = {
  android?: { adaptiveIcon?: { backgroundColor?: string } };
  plugins?: Plugin[];
};

function pluginProps(config: NativeConfig, name: string): PluginProps | undefined {
  const entry = config.plugins?.find((p) => (Array.isArray(p) ? p[0] : p) === name);
  return Array.isArray(entry) ? entry[1] : undefined;
}

function nativeColours(config: NativeConfig) {
  const splash = pluginProps(config, 'expo-splash-screen');
  return {
    adaptiveIcon: config.android?.adaptiveIcon?.backgroundColor,
    splash: splash?.backgroundColor,
    splashDark: splash?.dark?.backgroundColor,
    notification: pluginProps(config, 'expo-notifications')?.color,
  };
}

// app.json as the app config receives it, with every colour it might carry taken out.
function staticConfigWithoutColours(): NativeConfig {
  const { expo } = jest.requireActual('../../app.json');
  const config = JSON.parse(JSON.stringify(expo));
  delete config.android.adaptiveIcon.backgroundColor;
  for (const plugin of config.plugins) {
    if (!Array.isArray(plugin)) continue;
    delete plugin[1].backgroundColor;
    delete plugin[1].dark?.backgroundColor;
    delete plugin[1].color;
  }
  return config;
}

function load(tokens?: Record<string, string>) {
  let brand: Record<string, string> = {};
  let appConfig: (input: { config: NativeConfig }) => NativeConfig = () => ({});
  jest.isolateModules(() => {
    if (tokens) jest.doMock(TOKENS, () => tokens);
    brand = require('../theme/colors').brand;
    appConfig = require('../../app.config.js');
  });
  return { brand, appConfig };
}

describe('the colours native code draws before the app runs', () => {
  it('are the tokens for the app colour and the light primary in the resolved config', () => {
    const { brand } = load();
    const resolved = getConfig(projectRoot, { skipSDKVersionRequirement: true }).exp;
    expect(nativeColours(resolved)).toEqual({
      adaptiveIcon: brand.blue,
      splash: brand.blue,
      splashDark: brand.blue,
      notification: brand.tealLight,
    });
  });

  it('come from the app config, not from the static config', () => {
    const { brand, appConfig } = load();
    expect(nativeColours(appConfig({ config: staticConfigWithoutColours() }))).toEqual({
      adaptiveIcon: brand.blue,
      splash: brand.blue,
      splashDark: brand.blue,
      notification: brand.tealLight,
    });
  });

  it('follow a palette change made in the one token file', () => {
    const { brand, appConfig } = load({
      appColour: '#123456',
      appColourDeep: '#0A1B2C',
      notificationAccent: '#654321',
    });
    expect(brand.blue).toBe('#123456');
    expect(brand.blueDark).toBe('#0A1B2C');
    expect(brand.tealLight).toBe('#654321');
    expect(nativeColours(appConfig({ config: staticConfigWithoutColours() }))).toEqual({
      adaptiveIcon: '#123456',
      splash: '#123456',
      splashDark: '#123456',
      notification: '#654321',
    });
  });
});
