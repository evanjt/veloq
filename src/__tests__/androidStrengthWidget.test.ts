/**
 * Scenario: an athlete places the Strength widget from the Android widget gallery.
 *
 * Expected behaviour: the gallery names it in the athlete's language and describes it, the
 * widget is placed straight onto the trailing 30 days with no picker and nothing to reconfigure,
 * and every resource the manifest and the provider info point at exists in the generated project
 * in every locale.
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
  return new Set([...xml.matchAll(/@(?:\+id|android:id)\/(\w+)/g)].map((m) => m[1]));
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

  it('registers no picker, and drops one an earlier prebuild left in the manifest', () => {
    const stale = '.widget.StrengthWidgetConfigureActivity';
    const app: { activity: Entry[] } = { activity: [{ $: { 'android:name': stale } }] };
    androidPlugin.applyActivities(app);
    expect(app.activity.map((a) => a.$['android:name'])).not.toContain(stale);
  });

  it('is placed with no configure step, and compiles no picker', () => {
    const main = generate();
    const info = attributes(
      fs.readFileSync(path.join(main, 'res', 'xml', 'widget_strength_info.xml'), 'utf8')
    );
    expect(info['android:configure']).toBeUndefined();
    expect(info['android:widgetFeatures']).toBeUndefined();
    expect(info['android:description']).toBe('@string/widget_strength_description');
    expect(info['android:initialLayout']).toBe('@layout/widget_strength');
    const widgetJava = path.join(main, 'java', ...PKG.split('.'), 'widget');
    for (const file of ['StrengthWidgetConfigureActivity.kt', 'StrengthWidgetChoice.kt']) {
      expect([file, fs.existsSync(path.join(widgetJava, file))]).toEqual([file, false]);
    }
    for (const file of [
      'StrengthWidgetModel.kt',
      'StrengthWidgetRenderer.kt',
      'VeloqStrengthWidgetProvider.kt',
      'BodyBitmap.kt',
      'BodyOutline.kt',
    ]) {
      expect(fs.existsSync(path.join(widgetJava, file))).toBe(true);
    }
  });

  it('gives both layouts every view the renderer binds at every size', () => {
    const main = generate();
    const layout = (name: string) =>
      ids(fs.readFileSync(path.join(main, 'res', 'layout', `${name}.xml`), 'utf8'));
    const shared = [
      'background',
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
