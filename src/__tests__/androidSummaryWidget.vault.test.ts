/**
 * Scenario: an athlete places the Summary widget from the Android widget gallery.
 *
 * Expected behaviour: the gallery names it in the athlete's language and describes it, the
 * launcher opens the card's picker as the widget is placed and again on reconfigure, and the picker
 * is optional so dismissing it leaves a working widget, and every resource the manifest and the
 * provider info point at exists in the generated project.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { DOMParser } from '@xmldom/xmldom';

const plugin = require('@/../src/plugins/with-android-widget.js');
const strings = require('@/../src/plugins/nativeStrings.js');

const projectRoot = path.join(__dirname, '../..');
const PKG = 'com.example.widgets';
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function generate(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'summary-widget-'));
  dirs.push(root);
  plugin.writeWidgetSources(projectRoot, root, PKG);
  return path.join(root, 'app', 'src', 'main');
}

type Entry = { $: Record<string, string> };

function receivers(): Entry[] {
  const app: { receiver: Entry[] } = { receiver: [] };
  plugin.applyReceivers(app);
  return app.receiver;
}

function activities(): Entry[] {
  const app: { activity: Entry[] } = { activity: [] };
  plugin.applyActivities(app);
  return app.activity;
}

function attributes(xml: string): Record<string, string> {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const root = doc.documentElement;
  const out: Record<string, string> = {};
  for (let i = 0; i < root.attributes.length; i++) {
    out[root.attributes[i].name] = root.attributes[i].value;
  }
  return out;
}

describe('the Summary widget in the Android gallery', () => {
  it('is labelled with a string resource rather than the application name', () => {
    const summary = receivers().find((r) => r.$['android:name'] === '.widget.VeloqWidgetProvider');
    expect(summary?.$['android:label']).toBe('@string/widget_summary_label');
  });

  it('registers its picker activity with the launcher', () => {
    const picker = activities().find(
      (a) => a.$['android:name'] === '.widget.SummaryWidgetConfigureActivity'
    );
    expect(picker).toBeDefined();
    expect(picker?.$['android:exported']).toBe('true');
    expect(JSON.stringify(picker)).toContain('android.appwidget.action.APPWIDGET_CONFIGURE');
  });

  it('names a picker class that is generated into the package, and makes opening it optional', () => {
    const main = generate();
    const info = attributes(
      fs.readFileSync(path.join(main, 'res', 'xml', 'veloq_widget_info.xml'), 'utf8')
    );
    expect(info['android:configure']).toBe(`${PKG}.widget.SummaryWidgetConfigureActivity`);
    expect(info['android:widgetFeatures']).toBe('reconfigurable|configuration_optional');
    expect(info['android:description']).toBe('@string/widget_summary_description');
    expect(
      fs.existsSync(
        path.join(main, 'java', ...PKG.split('.'), 'widget', 'SummaryWidgetConfigureActivity.kt')
      )
    ).toBe(true);
  });

  it('defines the strings it points at, in every locale the app ships', () => {
    const main = generate();
    const files: Record<string, string> = strings.androidStringFiles(strings.loadLocaleBundles());
    const defined = (xml: string) =>
      new Set(
        Array.from(
          new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagName('string')
        ).map((s) => s.getAttribute('name'))
      );

    const wanted = [
      'widget_summary_label',
      'widget_summary_description',
      'widget_summary_choose',
      'widget_summary_metric',
      'widget_summary_follow_card',
      'widget_summary_sparkline',
      'widget_summary_supporting',
      'widget_summary_on',
      'widget_summary_off',
      'widget_summary_save',
    ];
    expect(Object.keys(files).length).toBeGreaterThan(1);
    for (const [dir, xml] of Object.entries(files)) {
      for (const name of wanted)
        expect([dir, name, defined(xml).has(name)]).toEqual([dir, name, true]);
    }
    for (const dir of Object.keys(files)) {
      expect(fs.existsSync(path.join(main, 'res', dir, strings.ANDROID_STRINGS_FILE))).toBe(true);
    }
  });
});
