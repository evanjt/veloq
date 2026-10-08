/**
 * Scenario: an athlete places the Strength widget from the iOS widget gallery, on iOS 16 and on
 * iOS 17, and picks its period in Edit Widget.
 *
 * Expected behaviour: both generated bundles carry the widget at the one kind, so a widget placed
 * before the upgrade to iOS 17 keeps its place; the extension compiles every file the widget is
 * written in; and the gallery name, description and period picker read a translation in every
 * language the catalogue carries.
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
  it('is in both bundles at the one kind, the static one below iOS 17', () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'strength-widget-ios-'));
    dirs.push(dest);
    iosPlugin.writeWidgetBundles(dest);
    const swift = fs.readFileSync(path.join(dest, 'WidgetBundles.swift'), 'utf8');
    const configurable = swift.indexOf('struct VeloqWidgetsConfigurable');
    expect(swift.slice(0, configurable)).toContain('VeloqStrengthWidget()');
    expect(swift.slice(configurable)).toContain('VeloqConfigurableStrengthWidget()');

    const kinds = [
      ...['WidgetStrength.swift', 'WidgetStrengthIntent.swift']
        .map(readWidget)
        .join('\n')
        .matchAll(/let kind = "(\w+)"/g),
    ].map((m) => m[1]);
    expect(kinds).toEqual(['VeloqStrengthWidget', 'VeloqStrengthWidget']);
  });

  it('compiles the Swift files the widget is written in', () => {
    const compiled = iosPlugin.widgetSwiftFiles(projectRoot);
    for (const file of [
      'StrengthWidgetModel.swift',
      'BodyShape.swift',
      'BodyOutline.swift',
      'WidgetStrength.swift',
      'WidgetStrengthIntent.swift',
    ]) {
      expect(compiled).toContain(file);
    }
  });

  it('names itself and its period picker in every language the catalogue carries', () => {
    const catalogue = strings.localizableCatalogue(strings.loadLocaleBundles());
    const languages: string[] = strings.appleLanguages();
    const gallery = /\.configurationDisplayName\("([^"]+)"\)\s*\.description\("([^"]+)"\)/g;
    const shown = [
      ...[...readWidget('WidgetStrength.swift').matchAll(gallery)].flatMap((m) => [m[1], m[2]]),
      ...[
        ...readWidget('WidgetStrengthIntent.swift').matchAll(
          /(?:title:|IntentDescription\(|LocalizedStringResource =)\s*"([^"]+)"/g
        ),
      ].map((m) => m[1]),
    ];

    expect(shown).toEqual(
      expect.arrayContaining([
        'Strength',
        'The muscles you trained, shaded by sets.',
        'Period',
        'Choose which days the widget shades.',
        'Last 30 days',
        'This Month',
      ])
    );
    for (const key of new Set(shown)) {
      const translated = Object.keys(catalogue.strings[key]?.localizations ?? {});
      expect([key, languages.filter((language) => !translated.includes(language))]).toEqual([
        key,
        [],
      ]);
    }
  });
});
