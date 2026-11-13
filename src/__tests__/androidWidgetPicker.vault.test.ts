/**
 * Scenario: an athlete opens the Android widget picker on Android 12 or later.
 *
 * Expected behaviour: every widget the app registers shows a line under its preview saying what it
 * shows, in the athlete's language. Each provider info names a description string, and that string
 * is generated for every locale the app ships. Each receiver names its widget with a label of its
 * own, so no entry in the list falls back to the application name.
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-picker-'));
  dirs.push(root);
  plugin.writeWidgetSources(projectRoot, root, PKG);
  return path.join(root, 'app', 'src', 'main', 'res');
}

type Entry = { $: Record<string, string>; 'meta-data': Entry[] };

/** The provider info resource each registered receiver points the launcher at. */
function providerInfos(): string[] {
  const app: { receiver: Entry[] } = { receiver: [] };
  plugin.applyReceivers(app);
  return app.receiver.map((r) => {
    const meta = r['meta-data'].find((m) => m.$['android:name'] === 'android.appwidget.provider');
    return (meta?.$['android:resource'] ?? '').replace('@xml/', '');
  });
}

function defined(xml: string): Set<string | null> {
  return new Set(
    Array.from(new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagName('string')).map(
      (s) => s.getAttribute('name')
    )
  );
}

describe('the Android widget picker', () => {
  it('describes every registered widget with a string defined in every locale', () => {
    const res = generate();
    const files: Record<string, string> = strings.androidStringFiles(strings.loadLocaleBundles());
    const infos = providerInfos();
    expect(infos).toContain('widget_activity_info');
    expect(Object.keys(files).length).toBeGreaterThan(1);

    for (const info of infos) {
      const file = path.join(res, 'xml', `${info}.xml`);
      const root = new DOMParser().parseFromString(
        fs.readFileSync(file, 'utf8'),
        'text/xml'
      ).documentElement;
      const description = root.getAttribute('android:description') ?? '';
      expect([info, description]).toEqual([info, expect.stringMatching(/^@string\/\w+$/)]);

      const name = description.replace('@string/', '');
      for (const [dir, xml] of Object.entries(files)) {
        expect([info, dir, name, defined(xml).has(name)]).toEqual([info, dir, name, true]);
      }
    }
  });

  it('names every registered widget with a label of its own, defined in every locale', () => {
    const files: Record<string, string> = strings.androidStringFiles(strings.loadLocaleBundles());
    const app: { receiver: Entry[] } = { receiver: [] };
    plugin.applyReceivers(app);
    expect(app.receiver.length).toBeGreaterThan(1);

    for (const receiver of app.receiver) {
      const name = receiver.$['android:name'];
      const label = receiver.$['android:label'] ?? '';
      expect([name, label]).toEqual([name, expect.stringMatching(/^@string\/\w+$/)]);
      expect([name, label]).not.toEqual([name, '@string/app_name']);

      const key = label.replace('@string/', '');
      for (const [dir, xml] of Object.entries(files)) {
        expect([name, dir, key, defined(xml).has(key)]).toEqual([name, dir, key, true]);
      }
    }
  });

  it('labels a receiver an earlier prebuild registered without one', () => {
    const app: { receiver: Entry[] } = {
      receiver: [
        {
          $: {
            'android:name': '.widget.VeloqActivityWidgetProvider',
            'android:exported': 'true',
          },
          'meta-data': [],
        },
      ],
    };
    plugin.applyReceivers(app);
    plugin.applyReceivers(app);

    const activity = app.receiver.filter(
      (r) => r.$['android:name'] === '.widget.VeloqActivityWidgetProvider'
    );
    expect(activity.map((r) => r.$['android:label'])).toEqual(['@string/widget_activity_label']);
  });
});
