/**
 * Scenario: an athlete places the Strength widget from the iOS widget gallery, on iOS 16 and on
 * iOS 17.
 *
 * Expected behaviour: both generated bundles carry the one static widget over the trailing 30
 * days at the one kind, so a widget placed while it still had a period to edit keeps its place
 * and has nothing left to edit; the extension compiles every file the widget is written in; and
 * the gallery name and description read a translation in every language the catalogue carries.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const iosPlugin = require('@/../src/plugins/with-ios-widget.js');
const strings = require('@/../src/plugins/nativeStrings.js');

const projectRoot = path.join(__dirname, '../..');
const WIDGET_DIR = path.join(projectRoot, 'widget/ios/VeloqWidget');
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function readWidget(file: string): string {
  const at = path.join(WIDGET_DIR, file);
  return fs.existsSync(at) ? fs.readFileSync(at, 'utf8') : '';
}

describe('the Strength widget in the iOS bundles', () => {
  it('is the one static widget in both bundles, at the kind it was placed under', () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'strength-widget-ios-'));
    dirs.push(dest);
    iosPlugin.writeWidgetBundles(dest);
    const swift = fs.readFileSync(path.join(dest, 'WidgetBundles.swift'), 'utf8');
    const configurable = swift.indexOf('struct VeloqWidgetsConfigurable');
    expect(swift.slice(0, configurable)).toContain('VeloqStrengthWidget()');
    expect(swift.slice(configurable)).toContain('VeloqStrengthWidget()');
    expect(swift).not.toContain('VeloqConfigurableStrengthWidget');

    const widget = readWidget('WidgetStrength.swift');
    expect([...widget.matchAll(/let kind = "(\w+)"/g)].map((m) => m[1])).toEqual([
      'VeloqStrengthWidget',
    ]);
    expect(widget).toContain('StaticConfiguration(kind: kind');
  });

  it('compiles the Swift files the widget is written in, and no period picker', () => {
    const compiled = iosPlugin.widgetSwiftFiles(projectRoot);
    for (const file of [
      'StrengthWidgetModel.swift',
      'BodyShape.swift',
      'BodyOutline.swift',
      'WidgetStrength.swift',
    ]) {
      expect(compiled).toContain(file);
    }
    expect(compiled).not.toContain('WidgetStrengthIntent.swift');
  });

  it('names itself in every language the catalogue carries', () => {
    const catalogue = strings.localizableCatalogue(strings.loadLocaleBundles());
    const languages: string[] = strings.appleLanguages();
    const gallery = /\.configurationDisplayName\("([^"]+)"\)\s*\.description\("([^"]+)"\)/g;
    const shown = [...readWidget('WidgetStrength.swift').matchAll(gallery)].flatMap((m) => [
      m[1],
      m[2],
    ]);

    expect(shown).toEqual(['Strength', 'The muscles you trained, shaded by sets.']);
    for (const key of new Set(shown)) {
      const translated = Object.keys(catalogue.strings[key]?.localizations ?? {});
      expect([key, languages.filter((language) => !translated.includes(language))]).toEqual([
        key,
        [],
      ]);
    }
  });
});
