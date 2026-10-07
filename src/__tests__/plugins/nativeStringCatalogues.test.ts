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

/**
 * A `.strings` table read back the way Foundation reads it: every line that is
 * not the header comment is one quoted pair, or the table is malformed.
 */
function stringsEntries(text: string): Record<string, string> {
  const literal = '"((?:[^"\\\\]|\\\\.)*)"';
  const pair = new RegExp(`^${literal} = ${literal};$`);
  const unescape = (value: string) => value.replace(/\\(.)/g, (_, c) => (c === 'n' ? '\n' : c));
  const entries: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (line === '' || /^\/\*.*\*\/$/.test(line)) continue;
    const match = pair.exec(line);
    if (!match) throw new Error(`malformed .strings line: ${line}`);
    entries[unescape(match[1])] = unescape(match[2]);
  }
  return entries;
}

describe('the App Shortcuts strings tables', () => {
  const files: Record<string, string> = strings.appShortcutsStringFiles(
    strings.loadLocaleBundles()
  );
  const table = (language: string) =>
    stringsEntries(files[path.join(`${language}.lproj`, 'AppShortcuts.strings')] ?? '');

  it('writes one table per Apple language and nothing else', () => {
    expect(Object.keys(files).sort()).toEqual(
      strings
        .appleLanguages()
        .map((language: string) => path.join(`${language}.lproj`, 'AppShortcuts.strings'))
        .sort()
    );
  });

  it.each([...SUPPORTED_LOCALES])('%s gives every phrase a translation Siri accepts', (locale) => {
    const { apple } = strings.PLATFORM_LOCALES[locale];
    const problems: string[] = [];
    for (const language of apple) {
      const phrases = table(language);
      expect(Object.keys(phrases).sort()).toEqual(
        strings.APP_SHORTCUT_PHRASES.map(({ key }: { key: string }) => key).sort()
      );
      for (const { key } of strings.APP_SHORTCUT_PHRASES) {
        const value = phrases[key] ?? '';
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
    const phrases = table(language);
    const values = strings.APP_SHORTCUT_PHRASES.map(({ key }: { key: string }) => phrases[key]);
    expect(new Set(values).size).toBe(values.length);
  });

  it('reads back a phrase carrying a quote, a backslash and a newline unchanged', () => {
    const bundles = strings.loadLocaleBundles();
    const tricky = `Lancer "l'enregistrement" \\ {{app}}\nmaintenant`;
    bundles.fr = {
      ...bundles.fr,
      systemSurfaces: {
        ...bundles.fr.systemSurfaces,
        phrases: { ...bundles.fr.systemSurfaces.phrases, startRecording: tricky },
      },
    };
    const fr = stringsEntries(
      strings.appShortcutsStringFiles(bundles)[path.join('fr.lproj', 'AppShortcuts.strings')]
    );
    expect(fr['Start recording on ${applicationName}']).toBe(
      tricky.replace('{{app}}', '${applicationName}')
    );
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
    for (const language of strings.appleLanguages()) {
      const table = path.join(iosRoot, 'ExampleApp', `${language}.lproj`, 'AppShortcuts.strings');
      expect(fs.existsSync(table)).toBe(true);
    }
    expect(fs.existsSync(path.join(iosRoot, 'VeloqWidget', 'en.lproj'))).toBe(false);
  });

  // Xcode refuses an AppShortcuts catalogue below iOS 17, and the app deploys to 16.4.
  it('leaves no AppShortcuts catalogue behind, including one an earlier prebuild wrote', () => {
    const iosRoot = tmp();
    fs.mkdirSync(path.join(iosRoot, 'ExampleApp'), { recursive: true });
    fs.writeFileSync(path.join(iosRoot, 'ExampleApp', 'AppShortcuts.xcstrings'), '{}');

    iosPlugin.writeWidgetFiles(projectRoot, iosRoot, 'ExampleApp');

    expect(fs.existsSync(path.join(iosRoot, 'ExampleApp', 'AppShortcuts.xcstrings'))).toBe(false);
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

  const unquoted = (value: unknown) => String(value).replace(/"/g, '');

  /**
   * Resource names a target copies, and the file type each reference carries.
   * A localised table is a variant group, listed with its language files.
   */
  function resources(proj: ReturnType<typeof openFixture>, target: string) {
    const uuid = iosPlugin.targetUuidByName(proj, target);
    const refs = proj.pbxFileReferenceSection();
    const builds = proj.pbxBuildFileSection();
    const variants = proj.hash.project.objects.PBXVariantGroup ?? {};
    return (proj.pbxResourcesBuildPhaseObj(uuid)?.files ?? []).map((entry: { value: string }) => {
      const fileRef = (builds[entry.value] as { fileRef: string }).fileRef;
      const variant = variants[fileRef];
      if (variant) {
        const languages = (variant.children ?? []).map((c: { value: string }) => {
          const ref = refs[c.value];
          return `${unquoted(ref.name)}:${unquoted(ref.path)}:${ref.lastKnownFileType}`;
        });
        return `${unquoted(variant.name)} variant [${languages.join(' ')}]`;
      }
      const ref = refs[fileRef];
      return `${path.basename(unquoted(ref.path))} ${ref.lastKnownFileType}`;
    });
  }

  const appShortcuts = (proj: ReturnType<typeof openFixture>, target: string) =>
    resources(proj, target).filter((r: string) => r.startsWith('AppShortcuts'));

  const expectedAppShortcuts = () =>
    `AppShortcuts.strings variant [${strings
      .appleLanguages()
      .map(
        (language: string) =>
          `${language}:${APP}/${language}.lproj/AppShortcuts.strings:text.plist.strings`
      )
      .join(' ')}]`;

  it('adds the string catalogue to both targets and the phrases to the app', () => {
    const proj = openFixture();
    configure(proj);

    expect(resources(proj, WIDGET)).toContain('Localizable.xcstrings text.json.xcstrings');
    expect(resources(proj, APP)).toContain('Localizable.xcstrings text.json.xcstrings');
    expect(appShortcuts(proj, APP)).toEqual([expectedAppShortcuts()]);
    expect(appShortcuts(proj, WIDGET)).toEqual([]);
  });

  it('replaces an AppShortcuts catalogue an earlier prebuild added with the strings tables', () => {
    const proj = openFixture();
    iosPlugin.addMissingStringCatalogues(
      proj,
      iosPlugin.targetUuidByName(proj, APP),
      ['AppShortcuts.xcstrings'],
      APP
    );
    expect(appShortcuts(proj, APP)).toEqual(['AppShortcuts.xcstrings text.json.xcstrings']);

    configure(proj);

    expect(appShortcuts(proj, APP)).toEqual([expectedAppShortcuts()]);
    const refs = proj.pbxFileReferenceSection();
    const stale = Object.keys(refs).filter(
      (key) => !key.endsWith('_comment') && unquoted(refs[key].path).endsWith('.xcstrings')
    );
    expect(stale.map((key) => path.basename(unquoted(refs[key].path)))).not.toContain(
      'AppShortcuts.xcstrings'
    );
  });

  it('adds a language the bundles gained since the last prebuild to the existing table', () => {
    const proj = openFixture();
    configure(proj);
    const variants = proj.hash.project.objects.PBXVariantGroup ?? {};
    const key = Object.keys(variants).find((k) => !k.endsWith('_comment'))!;
    const dropped = variants[key].children?.pop();
    expect(dropped).toBeDefined();
    expect(appShortcuts(proj, APP)).not.toEqual([expectedAppShortcuts()]);

    configure(proj);

    expect(appShortcuts(proj, APP).join()).toContain(`${unquoted(dropped?.comment)}:`);
    expect(Object.keys(variants).filter((k) => !k.endsWith('_comment'))).toHaveLength(1);
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
