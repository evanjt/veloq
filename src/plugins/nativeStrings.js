const fs = require('fs');
const path = require('path');

/**
 * The text native code compiles in and shows before the app has written any
 * snapshot: the widget gallery, the empty widget, the Control, the App Intents
 * and their Siri phrases, and the Android notification channel. A snapshot
 * cannot carry it because none exists yet when it is read, so prebuild
 * generates each platform's catalogue from the app's own locale bundles and the
 * translation stays in one place.
 *
 * On iOS the key is the English literal the Swift already passes: `Text`,
 * `LocalizedStringResource`, `IntentDescription` and the widget configuration
 * modifiers all look a literal up in the bundle's `Localizable` table, and an
 * App Shortcut phrase can only be keyed by its English text, so a catalogue
 * keyed the same way needs no change at the call sites. On Android the key is
 * a resource name, read with `getString` or `@string/`.
 */

const LOCALES_DIR = path.join(__dirname, '..', 'i18n', 'locales');

/**
 * Where each locale bundle lands on each platform. The root bundle, en-GB, is
 * also the bare `en` and Android's default `values`, so a language nobody
 * translated reads it rather than the Swift literal or nothing. de-DE is the
 * bare `de`, as the app's `CFBundleLocalizations` already names it, so German
 * in Austria reads it too. An Android qualifier with a script or a numeric
 * region needs the BCP 47 `b+` form.
 */
const PLATFORM_LOCALES = {
  'en-GB': { apple: ['en', 'en-GB'], android: [''] },
  'en-US': { apple: ['en-US'], android: ['en-rUS'] },
  'en-AU': { apple: ['en-AU'], android: ['en-rAU'] },
  es: { apple: ['es'], android: ['es'] },
  'es-ES': { apple: ['es-ES'], android: ['es-rES'] },
  'es-419': { apple: ['es-419'], android: ['b+es+419'] },
  fr: { apple: ['fr'], android: ['fr'] },
  'de-DE': { apple: ['de'], android: ['de'] },
  'de-CH': { apple: ['de-CH'], android: ['de-rCH'] },
  nl: { apple: ['nl'], android: ['nl'] },
  it: { apple: ['it'], android: ['it'] },
  pt: { apple: ['pt'], android: ['pt'] },
  'pt-BR': { apple: ['pt-BR'], android: ['pt-rBR'] },
  ja: { apple: ['ja'], android: ['ja'] },
  'zh-Hans': { apple: ['zh-Hans'], android: ['b+zh+Hans'] },
  pl: { apple: ['pl'], android: ['pl'] },
  da: { apple: ['da'], android: ['da'] },
};

/**
 * The `Localizable` keys, each the literal the Swift passes, and the bundle
 * path its translation is read from. Both targets get the whole table: the
 * shared sources are compiled into each, and a key a target never reads costs
 * nothing.
 */
const APPLE_STRINGS = [
  { key: 'Open Veloq', path: 'systemSurfaces.openApp' },
  { key: 'to see your training', path: 'systemSurfaces.toSeeTraining' },
  { key: 'Record', path: 'systemSurfaces.record' },
  { key: 'Start recording an activity.', path: 'systemSurfaces.recordDescription' },
  {
    key: 'Your form, fitness, and latest activity at a glance.',
    path: 'systemSurfaces.dashboardDescription',
  },
  { key: 'Latest Activity', path: 'systemSurfaces.latestActivity' },
  {
    key: 'Your most recent activity with its route.',
    path: 'systemSurfaces.latestActivityDescription',
  },
  { key: 'Metric', path: 'systemSurfaces.metric' },
  { key: 'Choose which metric the widget features.', path: 'systemSurfaces.metricDescription' },
  { key: 'Form', path: 'metrics.form' },
  { key: 'Fitness', path: 'metrics.fitness' },
  { key: 'Fatigue', path: 'metrics.fatigue' },
  { key: 'HRV', path: 'metrics.hrv' },
  { key: 'RHR', path: 'metrics.rhr' },
  { key: 'Summary', path: 'systemSurfaces.summary' },
  { key: 'Sport', path: 'systemSurfaces.sport' },
  { key: 'Choose which sport this widget starts.', path: 'systemSurfaces.sportDescription' },
  { key: 'Start recording', path: 'systemSurfaces.startRecording' },
  {
    key: 'Opens Veloq ready to record the last sport.',
    path: 'systemSurfaces.startRecordingDescription',
  },
  {
    key: 'Opens Veloq ready to record.',
    path: 'systemSurfaces.controlDescription',
  },
  { key: 'Start a sport', path: 'systemSurfaces.startSport' },
  {
    key: 'Opens Veloq ready to record the chosen sport.',
    path: 'systemSurfaces.startSportDescription',
  },
  { key: 'Recording control', path: 'systemSurfaces.recordingControl' },
  { key: 'Action', path: 'systemSurfaces.action' },
];

/**
 * The Siri phrases, keyed as an `AppShortcuts` table requires: the English
 * phrase with each interpolation written `${name}`. The bundles write the same
 * slots the i18next way, `{{app}}` and `{{sport}}`.
 */
const APP_SHORTCUT_PHRASES = [
  { key: 'Start a ride on ${applicationName}', path: 'systemSurfaces.phrases.startRide' },
  { key: 'Start recording on ${applicationName}', path: 'systemSurfaces.phrases.startRecording' },
  { key: 'Start a ${applicationName} ride', path: 'systemSurfaces.phrases.startAppRide' },
  { key: 'Start a ${sport} on ${applicationName}', path: 'systemSurfaces.phrases.startSport' },
  { key: 'Record a ${sport} on ${applicationName}', path: 'systemSurfaces.phrases.recordSport' },
];

const PHRASE_SLOTS = { app: '${applicationName}', sport: '${sport}' };

/** The Android resources, by name, and the bundle path each reads. */
const ANDROID_STRINGS = [
  { name: 'widget_open_app', path: 'systemSurfaces.openApp' },
  { name: 'widget_to_see_training', path: 'systemSurfaces.toSeeTraining' },
  { name: 'widget_record', path: 'systemSurfaces.record' },
  { name: 'notification_channel_insights_name', path: 'notifications.channel.insightsName' },
  {
    name: 'notification_channel_insights_description',
    path: 'notifications.channel.insightsDescription',
  },
];

const LOCALIZABLE_FILE = 'Localizable.xcstrings';
// A `.strings` table per language rather than a catalogue: Xcode refuses an
// `AppShortcuts` catalogue below iOS 17, and the app deploys to 16.4.
const APP_SHORTCUTS_FILE = 'AppShortcuts.strings';
const STALE_APP_SHORTCUTS_FILE = 'AppShortcuts.xcstrings';
const ANDROID_STRINGS_FILE = 'native_strings.xml';

const REGIONAL_BASES = {
  'en-AU': 'en-GB',
  'en-US': 'en-GB',
  'es-ES': 'es',
  'es-419': 'es',
};

function withOverrides(base, overrides) {
  const result = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    const inherited = result[key];
    result[key] =
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      inherited &&
      typeof inherited === 'object' &&
      !Array.isArray(inherited)
        ? withOverrides(inherited, value)
        : value;
  }
  return result;
}

function loadLocaleBundles(dir = LOCALES_DIR) {
  const bundles = {};
  for (const locale of Object.keys(PLATFORM_LOCALES)) {
    bundles[locale] = JSON.parse(fs.readFileSync(path.join(dir, `${locale}.json`), 'utf8'));
  }
  for (const [variant, base] of Object.entries(REGIONAL_BASES)) {
    bundles[variant] = withOverrides(bundles[base], bundles[variant]);
  }
  return bundles;
}

/**
 * A translation, or a refused prebuild naming the gap. Falling back to English
 * here would ship the untranslated string the catalogue exists to remove, and
 * the parity test keeps every bundle complete, so a gap is a defect.
 */
function translation(bundles, locale, dotted) {
  const value = dotted.split('.').reduce((node, part) => node?.[part], bundles[locale]);
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`native strings: ${locale} has no translation at ${dotted}`);
  }
  return value;
}

function catalogue(entries, bundles) {
  const strings = {};
  for (const { key, path: dotted } of entries) {
    const localizations = {};
    for (const [locale, { apple }] of Object.entries(PLATFORM_LOCALES)) {
      const value = translation(bundles, locale, dotted);
      for (const language of apple) {
        localizations[language] = { stringUnit: { state: 'translated', value } };
      }
    }
    strings[key] = { extractionState: 'manual', localizations };
  }
  return { sourceLanguage: 'en', strings, version: '1.0' };
}

function localizableCatalogue(bundles) {
  return catalogue(APPLE_STRINGS, bundles);
}

/** Each Apple language's phrases, keyed by the English phrase. */
function appShortcutPhrases(bundles) {
  const byLanguage = {};
  for (const [locale, { apple }] of Object.entries(PLATFORM_LOCALES)) {
    const phrases = {};
    for (const { key, path: dotted } of APP_SHORTCUT_PHRASES) {
      phrases[key] = translation(bundles, locale, dotted).replace(
        /\{\{(\w+)\}\}/g,
        (slot, name) => PHRASE_SLOTS[name] ?? slot
      );
    }
    for (const language of apple) byLanguage[language] = phrases;
  }
  return byLanguage;
}

/** A `.strings` literal: a backslash, a quote or a newline would end or bend it. */
function encodeStringsLiteral(value) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function stringsTable(entries, source) {
  const lines = Object.entries(entries).map(
    ([key, value]) => `"${encodeStringsLiteral(key)}" = "${encodeStringsLiteral(value)}";`
  );
  return `/* Generated at prebuild from ${source}. Do not edit. */\n${lines.join('\n')}\n`;
}

/** Every `AppShortcuts.strings`, keyed by its path under the app directory. */
function appShortcutsStringFiles(bundles) {
  const files = {};
  for (const [language, phrases] of Object.entries(appShortcutPhrases(bundles))) {
    files[path.join(`${language}.lproj`, APP_SHORTCUTS_FILE)] = stringsTable(
      phrases,
      'src/i18n/locales'
    );
  }
  return files;
}

/**
 * A value as aapt reads it back unchanged. Markup characters are entities, and
 * a backslash, a quote or an apostrophe is escaped, since aapt strips an
 * unescaped quote and refuses an unescaped apostrophe. A leading `@` or `?`
 * would read as a reference.
 */
function encodeAndroidString(value) {
  const escaped = value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n');
  return /^[@?]/.test(escaped) ? `\\${escaped}` : escaped;
}

/** The inverse of `encodeAndroidString` once the XML parser has read the entities. */
function decodeAndroidString(text) {
  return text.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c));
}

function androidStringsXml(bundles, locale) {
  const lines = ANDROID_STRINGS.map(
    ({ name, path: dotted }) =>
      `  <string name="${name}">${encodeAndroidString(translation(bundles, locale, dotted))}</string>`
  );
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated at prebuild from src/i18n/locales/${locale}.json. Do not edit. -->
<resources>
${lines.join('\n')}
</resources>
`;
}

/** Every strings file, keyed by its `values` directory. */
function androidStringFiles(bundles) {
  const files = {};
  for (const [locale, { android }] of Object.entries(PLATFORM_LOCALES)) {
    for (const qualifier of android) {
      files[qualifier ? `values-${qualifier}` : 'values'] = androidStringsXml(bundles, locale);
    }
  }
  return files;
}

function writeAndroidStrings(resDir, bundles = loadLocaleBundles()) {
  for (const [dir, xml] of Object.entries(androidStringFiles(bundles))) {
    fs.mkdirSync(path.join(resDir, dir), { recursive: true });
    fs.writeFileSync(path.join(resDir, dir, ANDROID_STRINGS_FILE), xml);
  }
}

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * The extension and the app each get the string catalogue; the phrases go to
 * the app alone, since only the app target's `AppShortcutsProvider` counts.
 */
function writeIosCatalogues({ widgetDir, appDir }, bundles = loadLocaleBundles()) {
  const localizable = json(localizableCatalogue(bundles));
  for (const dir of [widgetDir, appDir]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, LOCALIZABLE_FILE), localizable);
  }
  for (const [file, text] of Object.entries(appShortcutsStringFiles(bundles))) {
    fs.mkdirSync(path.dirname(path.join(appDir, file)), { recursive: true });
    fs.writeFileSync(path.join(appDir, file), text);
  }
  // An earlier prebuild wrote the phrases as a catalogue, which fails the build.
  fs.rmSync(path.join(appDir, STALE_APP_SHORTCUTS_FILE), { force: true });
}

/** Every Apple language a catalogue carries, for the project's known regions. */
function appleLanguages() {
  return Object.values(PLATFORM_LOCALES).flatMap(({ apple }) => apple);
}

module.exports = {
  PLATFORM_LOCALES,
  APPLE_STRINGS,
  APP_SHORTCUT_PHRASES,
  ANDROID_STRINGS,
  LOCALIZABLE_FILE,
  APP_SHORTCUTS_FILE,
  STALE_APP_SHORTCUTS_FILE,
  ANDROID_STRINGS_FILE,
  loadLocaleBundles,
  localizableCatalogue,
  appShortcutPhrases,
  appShortcutsStringFiles,
  androidStringFiles,
  encodeAndroidString,
  decodeAndroidString,
  writeAndroidStrings,
  writeIosCatalogues,
  appleLanguages,
};
