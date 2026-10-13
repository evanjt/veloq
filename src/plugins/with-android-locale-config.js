const fs = require('fs');
const path = require('path');
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins');

/**
 * Expo config plugin that lists Veloq under Android's App languages.
 *
 * Android 13 and later offers a per-app language only for an app whose
 * application element names a locale config, and offers the languages that
 * config lists. Those are the languages the in-app picker can store, so a
 * language chosen in either place is one the other can show as chosen. The
 * neutral Spanish bundle is a fallback with no picker entry and is left out.
 *
 * expo-localization writes the same file from its `supportedLocales`, and also
 * restricts the build's resources to those tags. That would drop the
 * language-only resource directories the native string catalogues write, such
 * as `values-de` for de-DE, so only its iOS half is used.
 */

const { PLATFORM_LOCALES } = require('./nativeStrings.js');

const LOCALE_CONFIG = 'locales_config';

/** Locale bundles with no picker entry of their own. */
const FALLBACK_ONLY = new Set(['es']);

/** The locales the platform setting offers, in the order the app ships them. */
function declaredLocales() {
  return Object.keys(PLATFORM_LOCALES).filter((locale) => !FALLBACK_ONLY.has(locale));
}

function localeConfigXml() {
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<locale-config xmlns:android="http://schemas.android.com/apk/res/android">',
    ...declaredLocales().map((locale) => `  <locale android:name="${locale}"/>`),
    '</locale-config>',
    '',
  ].join('\n');
}

/** Point the application element at the locale config, once however often it runs. */
function pointAtLocaleConfig(androidManifest) {
  const application = AndroidConfig.Manifest.getMainApplicationOrThrow(androidManifest);
  application.$ = { ...application.$, 'android:localeConfig': `@xml/${LOCALE_CONFIG}` };
  return androidManifest;
}

function withAndroidLocaleConfig(config) {
  config = withDangerousMod(config, [
    'android',
    (mod) => {
      const folder = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      fs.mkdirSync(folder, { recursive: true });
      fs.writeFileSync(path.join(folder, `${LOCALE_CONFIG}.xml`), localeConfigXml());
      return mod;
    },
  ]);
  return withAndroidManifest(config, (mod) => {
    mod.modResults = pointAtLocaleConfig(mod.modResults);
    return mod;
  });
}

module.exports = withAndroidLocaleConfig;
module.exports.localeConfigXml = localeConfigXml;
module.exports.pointAtLocaleConfig = pointAtLocaleConfig;
