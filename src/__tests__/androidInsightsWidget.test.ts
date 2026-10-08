/**
 * Scenario: an athlete places the Insights widget from the Android widget gallery and from the
 * iOS widget gallery.
 *
 * Expected behaviour: the gallery names it in the athlete's language and describes it, the
 * launcher opens the kinds picker as the widget is placed and again on reconfigure, dismissing the
 * picker leaves a working widget, every resource the manifest, the provider info and the picker
 * point at exists in the generated project in every locale, and both iOS bundles carry the widget
 * at the one kind, so a widget placed before the upgrade to iOS 17 keeps its place.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { DOMParser } from '@xmldom/xmldom';

import { insightCategories } from './__shared__/insightCategories';

const androidPlugin = require('@/../src/plugins/with-android-widget.js');
const iosPlugin = require('@/../src/plugins/with-ios-widget.js');
const strings = require('@/../src/plugins/nativeStrings.js');

const projectRoot = path.join(__dirname, '../..');
const PKG = 'com.example.widgets';
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name));
  dirs.push(dir);
  return dir;
}

function generate(): string {
  const root = tempDir('insights-widget-');
  androidPlugin.writeWidgetSources(projectRoot, root, PKG);
  return path.join(root, 'app', 'src', 'main');
}

type Entry = { $: Record<string, string> };

function infoAttributes(xml: string): Record<string, string> {
  const root = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
  const out: Record<string, string> = {};
  for (let i = 0; i < root.attributes.length; i++) {
    out[root.attributes[i].name] = root.attributes[i].value;
  }
  return out;
}

describe('the Insights widget in the Android gallery', () => {
  it('is registered with a label from the string resources, whatever the Record flag says', () => {
    for (const record of [true, false]) {
      const app: { receiver: Entry[] } = { receiver: [] };
      androidPlugin.applyReceivers(app);
      const insights = app.receiver.find(
        (r) => r.$['android:name'] === '.widget.VeloqInsightsWidgetProvider'
      );
      expect([record, insights?.$['android:label']]).toEqual([
        record,
        '@string/widget_insights_label',
      ]);
    }
  });

  it('registers its picker with the launcher, whatever the Record flag says', () => {
    for (const include of [true, false]) {
      const app: { activity: Entry[] } = { activity: [] };
      androidPlugin.applyActivities(app, include);
      const picker = app.activity.find(
        (a) => a.$['android:name'] === '.widget.InsightsWidgetConfigureActivity'
      );
      expect(picker?.$['android:exported']).toBe('true');
      expect(JSON.stringify(picker)).toContain('android.appwidget.action.APPWIDGET_CONFIGURE');
    }
  });

  it('names a picker class that is generated into the package, and makes opening it optional', () => {
    const main = generate();
    const info = infoAttributes(
      fs.readFileSync(path.join(main, 'res', 'xml', 'widget_insights_info.xml'), 'utf8')
    );
    expect(info['android:configure']).toBe(`${PKG}.widget.InsightsWidgetConfigureActivity`);
    expect(info['android:widgetFeatures']).toBe('reconfigurable|configuration_optional');
    expect(info['android:description']).toBe('@string/widget_insights_description');
    for (const file of [
      'InsightsWidgetConfigureActivity.kt',
      'VeloqInsightsWidgetProvider.kt',
      'InsightsWidgetRenderer.kt',
    ]) {
      expect(fs.existsSync(path.join(main, 'java', ...PKG.split('.'), 'widget', file))).toBe(true);
    }
  });

  it('defines the strings it points at, one name for every category, in every locale', () => {
    const main = generate();
    const files: Record<string, string> = strings.androidStringFiles(strings.loadLocaleBundles());
    const defined = (xml: string) =>
      new Set(
        Array.from(
          new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagName('string')
        ).map((s) => s.getAttribute('name'))
      );
    const wanted = [
      'widget_insights_label',
      'widget_insights_description',
      'widget_insights_empty',
      'widget_insights_more',
      'widget_insights_kinds_choose',
      'widget_insights_save',
      ...insightCategories().map((kind) => `widget_insight_kind_${kind}`),
    ];

    expect(Object.keys(files).length).toBeGreaterThan(1);
    for (const [dir, xml] of Object.entries(files)) {
      const names = defined(xml);
      expect([dir, wanted.filter((name) => !names.has(name))]).toEqual([dir, []]);
    }
    for (const dir of Object.keys(files)) {
      expect(fs.existsSync(path.join(main, 'res', dir, strings.ANDROID_STRINGS_FILE))).toBe(true);
    }
  });

  it('writes the count of further rows from a template that keeps its slot in every locale', () => {
    const files: Record<string, string> = strings.androidStringFiles(strings.loadLocaleBundles());
    for (const [dir, xml] of Object.entries(files)) {
      const more = new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagName('string');
      const template = Array.from(more).find(
        (s) => s.getAttribute('name') === 'widget_insights_more'
      );
      expect([dir, template?.textContent?.includes('{{rest}}')]).toEqual([dir, true]);
    }
  });
});

describe('the Insights widget in the iOS bundles', () => {
  it('is in both bundles at the one kind, the static one below iOS 17', () => {
    const dest = tempDir('insights-widget-ios-');
    iosPlugin.writeWidgetBundles(dest);
    const swift = fs.readFileSync(path.join(dest, 'WidgetBundles.swift'), 'utf8');
    const configurable = swift.indexOf('struct VeloqWidgetsConfigurable');
    expect(swift.slice(0, configurable)).toContain('VeloqInsightsWidget()');
    expect(swift.slice(configurable)).toContain('VeloqConfigurableInsightsWidget()');

    const kinds = [
      ...['WidgetInsights.swift', 'WidgetInsightsIntent.swift']
        .map((file) =>
          fs.readFileSync(path.join(projectRoot, 'widget/ios/VeloqWidget', file), 'utf8')
        )
        .join('\n')
        .matchAll(/let kind = "(\w+)"/g),
    ].map((m) => m[1]);
    expect(kinds).toEqual(['VeloqInsightsWidget', 'VeloqInsightsWidget']);
  });

  it('compiles the Swift files the widget is written in', () => {
    const compiled = iosPlugin.widgetSwiftFiles(projectRoot);
    for (const file of [
      'InsightsWidgetModel.swift',
      'WidgetInsights.swift',
      'WidgetInsightsIntent.swift',
    ]) {
      expect(compiled).toContain(file);
    }
  });
});
