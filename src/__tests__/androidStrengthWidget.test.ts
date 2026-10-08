/**
 * Scenario: an athlete places the Strength widget from the Android widget gallery.
 *
 * Expected behaviour: the gallery names it in the athlete's language and describes it, the
 * launcher opens the window picker as the widget is placed and again on reconfigure, dismissing
 * the picker leaves a working widget, and every resource the manifest, the provider info and the
 * picker point at exists in the generated project in every locale.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { DOMParser } from '@xmldom/xmldom';

const androidPlugin = require('@/../src/plugins/with-android-widget.js');
const strings = require('@/../src/plugins/nativeStrings.js');

const projectRoot = path.join(__dirname, '../..');
const PKG = 'com.example.widgets';
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function generate(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'strength-widget-'));
  dirs.push(root);
  androidPlugin.writeWidgetSources(projectRoot, root, PKG);
  return path.join(root, 'app', 'src', 'main');
}

type Entry = { $: Record<string, string> };

function attributes(xml: string): Record<string, string> {
  const root = new DOMParser().parseFromString(xml, 'text/xml').documentElement;
  const out: Record<string, string> = {};
  for (let i = 0; i < root.attributes.length; i++) {
    out[root.attributes[i].name] = root.attributes[i].value;
  }
  return out;
}

function ids(xml: string): Set<string> {
  return new Set([...xml.matchAll(/@\+id\/(\w+)/g)].map((m) => m[1]));
}

describe('the Strength widget in the Android gallery', () => {
  it('is registered with its provider info and a label from the string resources', () => {
    const app: { receiver: Entry[] } = { receiver: [] };
    androidPlugin.applyReceivers(app);
    const strength = app.receiver.find(
      (r) => r.$['android:name'] === '.widget.VeloqStrengthWidgetProvider'
    );
    expect(strength?.$['android:label']).toBe('@string/widget_strength_label');
    expect(JSON.stringify(strength)).toContain('@xml/widget_strength_info');
  });

  it('registers its picker with the launcher, whatever the Record flag says', () => {
    for (const include of [true, false]) {
      const app: { activity: Entry[] } = { activity: [] };
      androidPlugin.applyActivities(app, include);
      const picker = app.activity.find(
        (a) => a.$['android:name'] === '.widget.StrengthWidgetConfigureActivity'
      );
      expect(picker?.$['android:exported']).toBe('true');
      expect(JSON.stringify(picker)).toContain('android.appwidget.action.APPWIDGET_CONFIGURE');
    }
  });

  it('names a picker class generated into the package, and makes opening it optional', () => {
    const main = generate();
    const info = attributes(
      fs.readFileSync(path.join(main, 'res', 'xml', 'widget_strength_info.xml'), 'utf8')
    );
    expect(info['android:configure']).toBe(`${PKG}.widget.StrengthWidgetConfigureActivity`);
    expect(info['android:widgetFeatures']).toBe('reconfigurable|configuration_optional');
    expect(info['android:description']).toBe('@string/widget_strength_description');
    expect(info['android:initialLayout']).toBe('@layout/widget_strength');
    for (const file of [
      'StrengthWidgetConfigureActivity.kt',
      'StrengthWidgetChoice.kt',
      'StrengthWidgetModel.kt',
      'StrengthWidgetRenderer.kt',
      'VeloqStrengthWidgetProvider.kt',
      'BodyBitmap.kt',
      'BodyOutline.kt',
    ]) {
      expect(fs.existsSync(path.join(main, 'java', ...PKG.split('.'), 'widget', file))).toBe(true);
    }
  });

  it('gives both layouts every view the renderer binds at every size', () => {
    const main = generate();
    const layout = (name: string) =>
      ids(fs.readFileSync(path.join(main, 'res', 'layout', `${name}.xml`), 'utf8'));
    const shared = [
      'str_root',
      'str_label',
      'str_front',
      'str_back',
      'str_message',
      'str_empty',
      'str_empty_hint',
      'str_age',
      'str_updated',
    ];
    const rows = [0, 1, 2, 3].flatMap((i) => [`str_row${i}`, `str_name${i}`, `str_detail${i}`]);
    const small = layout('widget_strength_small');
    const wide = layout('widget_strength');
    expect(shared.filter((id) => !small.has(id))).toEqual([]);
    expect([...shared, 'str_bodies', ...rows].filter((id) => !wide.has(id))).toEqual([]);
  });

  it('defines the strings it points at in every locale', () => {
    const main = generate();
    const files: Record<string, string> = strings.androidStringFiles(strings.loadLocaleBundles());
    const defined = (xml: string) =>
      new Set(
        Array.from(
          new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagName('string')
        ).map((s) => s.getAttribute('name'))
      );
    const wanted = [
      'widget_strength_label',
      'widget_strength_description',
      'widget_strength_choose',
      'widget_open_app',
      'widget_to_see_training',
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
});
