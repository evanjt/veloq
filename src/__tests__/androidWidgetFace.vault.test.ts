/**
 * Scenario: a launcher inflates a widget's layout through the framework TextView, which reads a
 * font family's `android:` attributes and not the AndroidX `app:` ones the app's own family
 * carries, and finds a font a layout names only if the widget plugin wrote it.
 *
 * Expected behaviour: the plugin writes the widget family with both namespaces, at 400, 600 and
 * 700 so `textStyle="bold"` picks the bold file, beside the bundled files it names, and every
 * family a written layout or the picker theme names is one it wrote.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { DOMParser } from '@xmldom/xmldom';

const plugin = require('@/../src/plugins/with-android-widget.js');

const projectRoot = path.join(__dirname, '../..');
const PKG = 'com.example.widgets';
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function generate(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-face-'));
  dirs.push(root);
  plugin.writeWidgetSources(projectRoot, root, PKG);
  return path.join(root, 'app', 'src', 'main', 'res');
}

function fonts(res: string, family: string) {
  const xml = fs.readFileSync(path.join(res, 'font', `${family}.xml`), 'utf8');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const list = doc.getElementsByTagName('font');
  return Array.from({ length: list.length }, (_, i) => {
    const font = list[i];
    return {
      font: font.getAttribute('android:font'),
      weight: font.getAttribute('android:fontWeight'),
      style: font.getAttribute('android:fontStyle'),
      appFont: font.getAttribute('app:font'),
      appWeight: font.getAttribute('app:fontWeight'),
    };
  });
}

describe('the Android widget face', () => {
  it('writes the widget family at 400, 600 and 700 in both namespaces, beside the files it names', () => {
    const res = generate();
    const family = fonts(res, 'widget_manrope');
    expect(family.map((f) => [f.weight, f.style])).toEqual([
      ['400', 'normal'],
      ['600', 'normal'],
      ['700', 'normal'],
    ]);
    for (const f of family) {
      expect(f.appFont).toBe(f.font);
      expect(f.appWeight).toBe(f.weight);
    }
    const files = family.map((f) => (f.font ?? '').replace('@font/', ''));
    const bundled: Record<string, string> = {
      '400': 'Manrope-Regular.ttf',
      '600': 'Manrope-SemiBold.ttf',
      '700': 'Manrope-Bold.ttf',
    };
    family.forEach((f, i) => {
      const written = fs.readFileSync(path.join(res, 'font', `${files[i]}.ttf`));
      const source = fs.readFileSync(
        path.join(projectRoot, 'assets/fonts', bundled[f.weight ?? ''])
      );
      expect(written.equals(source)).toBe(true);
    });
  });

  it('names no family in a written layout or the picker theme that it did not write', () => {
    const res = generate();
    const written = new Set(
      fs.readdirSync(path.join(res, 'font')).map((f) => `@font/${f.replace(/\.\w+$/, '')}`)
    );
    const named = new Set<string>();
    const sources = [
      ...fs.readdirSync(path.join(res, 'layout')).map((file) => path.join(res, 'layout', file)),
      path.join(res, 'values', 'widget_configure_theme.xml'),
    ];
    for (const file of sources) {
      const xml = fs.readFileSync(file, 'utf8');
      for (const [, ref] of xml.matchAll(/android:fontFamily="([^"]+)"/g)) named.add(ref);
      for (const [, ref] of xml.matchAll(/name="(?:android:)?fontFamily">([^<]+)</g))
        named.add(ref);
    }
    expect(named).toEqual(new Set(['@font/widget_manrope']));
    for (const ref of named) expect(written.has(ref)).toBe(true);
  });
});
