/**
 * Scenario: the platform's own per-app language setting offers only the languages the build
 * declares. iOS reads `CFBundleLocalizations`; Android 13 and later lists an app under App
 * languages only when its manifest points at a locale config.
 *
 * Expected behaviour: both declarations are generated from the locales the app ships, so every
 * language the in-app picker offers, Swiss German and Spanish (Spain) among them, can be chosen in
 * the platform setting too, and no hand-written list sits beside them to drift.
 */

import { SUPPORTED_LOCALES } from '@/i18n/types';
import { getAvailableLanguages } from '@/shared/app/LanguageStore';

const appConfig = require('../../app.config.js');
const strings = require('../plugins/nativeStrings.js');
const localeConfig = require('../plugins/with-android-locale-config.js');

type Plugin = string | [string, Record<string, unknown>];
type ResolvedConfig = {
  ios?: { infoPlist?: Record<string, unknown> };
  plugins?: Plugin[];
};

// The app config over app.json, as prebuild receives it before any plugin runs.
const resolved: ResolvedConfig = appConfig({
  config: JSON.parse(JSON.stringify(jest.requireActual('../../app.json').expo)),
});

function pluginProps(name: string): Record<string, unknown> | undefined {
  const entry = resolved.plugins?.find((p) => (Array.isArray(p) ? p[0] : p) === name);
  return Array.isArray(entry) ? entry[1] : undefined;
}

/** Every value a tap in the in-app picker can store. */
const pickerLocales = getAvailableLanguages()
  .flatMap((group) => group.languages)
  .flatMap((lang) => (lang.variants ? lang.variants.map((v) => v.value) : [lang.value]));

describe('the iOS bundle localisations', () => {
  const declared = (
    pluginProps('expo-localization')?.supportedLocales as { ios?: string[] } | undefined
  )?.ios;

  it('are handed to expo-localization from the shipped locales', () => {
    const shipped = SUPPORTED_LOCALES.flatMap(
      (locale) => strings.PLATFORM_LOCALES[locale].apple as string[]
    );
    expect([...(declared ?? [])].sort()).toEqual([...new Set(shipped)].sort());
  });

  it.each(pickerLocales)('declare %s', (locale) => {
    const apple: string[] = strings.PLATFORM_LOCALES[locale].apple;
    for (const language of apple) expect(declared).toContain(language);
  });

  it('are not also hand-written into the Info.plist', () => {
    expect(resolved.ios?.infoPlist?.CFBundleLocalizations).toBeUndefined();
  });
});

describe('the Android locale config', () => {
  it('is applied by the app config', () => {
    const names = resolved.plugins?.map((p) => (Array.isArray(p) ? p[0] : p));
    expect(names).toContain('./src/plugins/with-android-locale-config');
  });

  it.each(pickerLocales)('lists %s', (locale) => {
    expect(localeConfig.localeConfigXml()).toContain(`<locale android:name="${locale}"/>`);
  });

  it('lists only locales the picker can show as chosen', () => {
    const listed = [...localeConfig.localeConfigXml().matchAll(/android:name="([^"]+)"/g)].map(
      (m) => m[1]
    );
    expect(listed.sort()).toEqual([...pickerLocales].sort());
  });

  it('is named by the application element', () => {
    const manifest = {
      manifest: { application: [{ $: { 'android:name': '.MainApplication' } }] },
    };
    const out = localeConfig.pointAtLocaleConfig(manifest);
    expect(out.manifest.application[0].$['android:localeConfig']).toBe('@xml/locales_config');
  });
});
