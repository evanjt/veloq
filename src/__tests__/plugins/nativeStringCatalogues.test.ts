/**
 * Scenario: the widget gallery, the empty widget, the Control, the Siri phrases
 * and the Android notification channel are read before the app has written any
 * snapshot, so their text is compiled into the binary rather than carried in
 * one. With no catalogue in the bundle every one of them is English in every
 * locale.
 *
 * Expected behaviour: prebuild generates the platform catalogues from the app's
 * own locale bundles, every supported locale yields every key, and the files
 * are wired into the targets that read them.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import { DOMParser } from '@xmldom/xmldom';
import xcode from 'xcode';

import { SUPPORTED_LOCALES } from '@/i18n/types';
import { resolvedLocale } from '../i18n/resolvedLocale';

const strings = require('@/../src/plugins/nativeStrings.js');
const iosPlugin = require('@/../src/plugins/with-ios-widget.js');
const androidPlugin = require('@/../src/plugins/with-android-widget.js');

const projectRoot = path.join(__dirname, '../../..');

type Bundle = Record<string, unknown>;
type StringUnit = { stringUnit: { state: string; value: string } };
type Catalogue = {
  sourceLanguage: string;
  version: string;
  strings: Record<string, { localizations: Record<string, StringUnit> }>;
};

const bundle = (locale: string): Bundle => resolvedLocale(locale);

const at = (source: Bundle, dotted: string): unknown =>
  dotted
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], source);

const dirs: string[] = [];
const tmp = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-native-strings-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** The string resources of one file, decoded back to the text a device shows. */
function androidValues(xml: string): Record<string, string> {
  const doc = new DOMParser({
    errorHandler: {
      warning: () => undefined,
      error: (message: string) => {
        throw new Error(message);
      },
      fatalError: (message: string) => {
        throw new Error(message);
      },
    },
  }).parseFromString(xml, 'text/xml');
  const values: Record<string, string> = {};
  const nodes = doc.getElementsByTagName('string');
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes.item(i)!;
    values[node.getAttribute('name')!] = strings.decodeAndroidString(node.textContent ?? '');
  }
  return values;
}

describe('every supported locale has a home on both platforms', () => {
  it('maps each locale bundle to its Apple languages and Android qualifiers', () => {
    expect(Object.keys(strings.PLATFORM_LOCALES).sort()).toEqual([...SUPPORTED_LOCALES].sort());
  });

  it('gives no two locales the same Apple language or Android qualifier', () => {
    const apple = Object.values(strings.PLATFORM_LOCALES).flatMap(
      (p) => (p as { apple: string[] }).apple
    );
    const android = Object.values(strings.PLATFORM_LOCALES).flatMap(
      (p) => (p as { android: string[] }).android
    );
    expect(new Set(apple).size).toBe(apple.length);
    expect(new Set(android).size).toBe(android.length);
  });
});

describe('the iOS string catalogue', () => {
  const catalogue: Catalogue = strings.localizableCatalogue(strings.loadLocaleBundles());

  it.each([...SUPPORTED_LOCALES])('%s carries every widget, Control and intent key', (locale) => {
    const source = bundle(locale);
    const { apple } = strings.PLATFORM_LOCALES[locale];
    const missing: string[] = [];
    for (const { key, path: dotted } of strings.APPLE_STRINGS) {
      const expected = at(source, dotted);
      for (const language of apple) {
        const unit = catalogue.strings[key]?.localizations[language]?.stringUnit;
        if (typeof expected !== 'string' || !expected.trim() || unit?.value !== expected) {
          missing.push(`${language}: ${key}`);
        } else if (unit.state !== 'translated') {
          missing.push(`${language}: ${key} (${unit.state})`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('declares English as its source, the language the Swift keys are written in', () => {
    expect(catalogue.sourceLanguage).toBe('en');
    expect(catalogue.version).toBe('1.0');
  });
});

describe('the App Shortcuts catalogue', () => {
  const catalogue: Catalogue = strings.appShortcutsCatalogue(strings.loadLocaleBundles());

  it.each([...SUPPORTED_LOCALES])('%s gives every phrase a translation Siri accepts', (locale) => {
    const { apple } = strings.PLATFORM_LOCALES[locale];
    const problems: string[] = [];
    for (const { key } of strings.APP_SHORTCUT_PHRASES) {
      for (const language of apple) {
        const value = catalogue.strings[key]?.localizations[language]?.stringUnit.value ?? '';
        // Siri refuses a phrase that does not name the app exactly once.
        if (value.split('${applicationName}').length !== 2) problems.push(`${language}: ${key}`);
        if (key.includes('${sport}') !== value.includes('${sport}')) {
          problems.push(`${language}: ${key} drops or adds the sport`);
        }
        if (value.includes('{{')) problems.push(`${language}: ${key} keeps i18next syntax`);
      }
    }
    expect(problems).toEqual([]);
  });

  it.each([...SUPPORTED_LOCALES])('%s gives each phrase different words', (locale) => {
    const [language] = strings.PLATFORM_LOCALES[locale].apple;
    const values = strings.APP_SHORTCUT_PHRASES.map(
      ({ key }: { key: string }) => catalogue.strings[key].localizations[language].stringUnit.value
    );
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('the Android string resources', () => {
  const files: Record<string, string> = strings.androidStringFiles(strings.loadLocaleBundles());

  it.each([...SUPPORTED_LOCALES])('%s yields every widget and channel string', (locale) => {
    const source = bundle(locale);
    for (const qualifier of strings.PLATFORM_LOCALES[locale].android) {
      const dir = qualifier ? `values-${qualifier}` : 'values';
      const values = androidValues(files[dir]);
      const expected = Object.fromEntries(
        strings.ANDROID_STRINGS.map(({ name, path: dotted }: { name: string; path: string }) => [
          name,
          at(source, dotted),
        ])
      );
      expect(values).toEqual(expected);
    }
  });

  it('escapes what aapt would otherwise read as markup or a reference', () => {
    const value = `@l'activité "100%" & <b>\\n`;
    const xml = `<resources><string name="x">${strings.encodeAndroidString(value)}</string></resources>`;
    expect(androidValues(xml).x).toBe(value);
  });
});

describe('prebuild writes the catalogues where the targets read them', () => {
  it('puts a strings file for every locale under the Android res tree', () => {
    const androidRoot = tmp();
    androidPlugin.writeWidgetSources(projectRoot, androidRoot, 'com.example.widgets');
    const res = path.join(androidRoot, 'app', 'src', 'main', 'res');
    for (const qualifiers of Object.values(strings.PLATFORM_LOCALES)) {
      for (const qualifier of (qualifiers as { android: string[] }).android) {
        const dir = qualifier ? `values-${qualifier}` : 'values';
        expect(fs.existsSync(path.join(res, dir, strings.ANDROID_STRINGS_FILE))).toBe(true);
      }
    }
  });

  it('puts the string catalogue beside both targets and the phrases in the app', () => {
    const iosRoot = tmp();
    iosPlugin.writeWidgetFiles(projectRoot, iosRoot, 'ExampleApp');
    expect(fs.existsSync(path.join(iosRoot, 'VeloqWidget', 'Localizable.xcstrings'))).toBe(true);
    expect(fs.existsSync(path.join(iosRoot, 'ExampleApp', 'Localizable.xcstrings'))).toBe(true);
    expect(fs.existsSync(path.join(iosRoot, 'ExampleApp', 'AppShortcuts.xcstrings'))).toBe(true);
    expect(fs.existsSync(path.join(iosRoot, 'VeloqWidget', 'AppShortcuts.xcstrings'))).toBe(false);
  });
});

describe('the Xcode project compiles the catalogues', () => {
  const APP = 'VeloqDev';
  const WIDGET = 'VeloqWidget';

  function openFixture(name = 'project.pbxproj') {
    const dir = tmp();
    const file = path.join(dir, 'project.pbxproj');
    fs.copyFileSync(path.join(__dirname, '__fixtures__', name), file);
    return xcode.project(file).parseSync();
  }

  const configure = (proj: ReturnType<typeof openFixture>) =>
    iosPlugin.configureWidgetProject(proj, {
      projectName: APP,
      swiftFiles: iosPlugin.widgetSwiftFiles(projectRoot),
      bundleId: 'com.example.widgets',
      version: '1.0.0',
      buildNumber: '1',
    });

  /** Resource names a target copies, and the file type each reference carries. */
  function resources(proj: ReturnType<typeof openFixture>, target: string) {
    const uuid = iosPlugin.targetUuidByName(proj, target);
    const refs = proj.pbxFileReferenceSection();
    const builds = proj.pbxBuildFileSection();
    return (proj.pbxResourcesBuildPhaseObj(uuid)?.files ?? []).map((entry: { value: string }) => {
      const ref = refs[(builds[entry.value] as { fileRef: string }).fileRef];
      return `${path.basename(String(ref.path).replace(/"/g, ''))} ${ref.lastKnownFileType}`;
    });
  }

  it('adds the string catalogue to both targets and the phrases to the app', () => {
    const proj = openFixture();
    configure(proj);

    expect(resources(proj, WIDGET)).toContain('Localizable.xcstrings text.json.xcstrings');
    expect(resources(proj, APP)).toContain('Localizable.xcstrings text.json.xcstrings');
    expect(resources(proj, APP)).toContain('AppShortcuts.xcstrings text.json.xcstrings');
    expect(resources(proj, WIDGET)).not.toContain('AppShortcuts.xcstrings text.json.xcstrings');
  });

  it('adds nothing on a second prebuild over the same project', () => {
    const proj = openFixture();
    configure(proj);
    const app = resources(proj, APP);
    const widget = resources(proj, WIDGET);

    configure(proj);

    expect(resources(proj, APP)).toEqual(app);
    expect(resources(proj, WIDGET)).toEqual(widget);
  });

  it('gives a target with nothing to copy a Resources phase to hold them', () => {
    const proj = openFixture('app-only.pbxproj');
    expect(proj.pbxResourcesBuildPhaseObj(iosPlugin.targetUuidByName(proj, APP))).toBeNull();

    configure(proj);

    expect(resources(proj, APP)).toContain('Localizable.xcstrings text.json.xcstrings');
    expect(resources(proj, WIDGET)).toContain('Localizable.xcstrings text.json.xcstrings');
  });

  it('lists every catalogue language as a region the project knows', () => {
    const proj = openFixture();
    configure(proj);

    const languages = Object.values(strings.PLATFORM_LOCALES).flatMap(
      (p) => (p as { apple: string[] }).apple
    );
    const unknown = languages.filter((language) => !proj.hasKnownRegion(language));
    expect(unknown).toEqual([]);
  });
});
