/**
 * Scenario: an athlete places a configurable widget, which opens a full-screen picker activity on
 * a phone that enforces edge-to-edge.
 *
 * Expected behaviour: every picker runs under one Material 3 theme in the brand colours, so its
 * toolbar, ticks, radios and Save button match the app in light and dark. The theme and every
 * resource the picker layouts point at exist in the generated project, in every locale, and the
 * Material components library the pickers compile against is a direct dependency of the app
 * rather than one that happens to arrive through another library.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import { DOMParser } from '@xmldom/xmldom';

const plugin = require('@/../src/plugins/with-android-widget.js');

const projectRoot = path.join(__dirname, '../..');
const PKG = 'com.example.trailhead';
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function generate(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-configure-'));
  dirs.push(root);
  plugin.writeWidgetSources(projectRoot, root, PKG);
  return path.join(root, 'app', 'src', 'main');
}

type Entry = { $: Record<string, string> };

function pickers(): Entry[] {
  const app: { activity: Entry[] } = { activity: [] };
  plugin.applyActivities(app);
  return app.activity;
}

function parse(file: string) {
  return new DOMParser().parseFromString(fs.readFileSync(file, 'utf8'), 'text/xml');
}

/** Every resource of one type defined under `values*` directories, keyed by directory. */
function defined(res: string, tag: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const dir of fs.readdirSync(res).filter((d) => d.startsWith('values'))) {
    const names = new Set<string>();
    for (const file of fs.readdirSync(path.join(res, dir)).filter((f) => f.endsWith('.xml'))) {
      for (const el of Array.from(parse(path.join(res, dir, file)).getElementsByTagName(tag))) {
        names.add(el.getAttribute('name') ?? '');
      }
    }
    out.set(dir, names);
  }
  return out;
}

const CONFIGURE_LAYOUTS = [
  'widget_configure_shell.xml',
  'widget_insights_configure.xml',
  'widget_summary_configure.xml',
  'widget_summary_placement_configure.xml',
];

describe('the Android widget pickers', () => {
  it('run every picker under one shared theme', () => {
    expect(plugin.CONFIGURE_THEME).toMatch(/^@style\/\S+$/);
    const themes = pickers().map((a) => a.$['android:theme']);
    expect(themes.length).toBeGreaterThan(0);
    expect(new Set(themes)).toEqual(new Set([plugin.CONFIGURE_THEME]));
  });

  it('defines that theme as a Material 3 day-night theme carrying the brand primary', () => {
    const res = path.join(generate(), 'res');
    const name = plugin.CONFIGURE_THEME.replace('@style/', '');
    const styles = fs
      .readdirSync(path.join(res, 'values'))
      .filter((f) => f.endsWith('.xml'))
      .flatMap((f) => Array.from(parse(path.join(res, 'values', f)).getElementsByTagName('style')))
      .filter((s) => s.getAttribute('name') === name);
    expect(styles).toHaveLength(1);
    expect(styles[0].getAttribute('parent')).toBe('Theme.Material3.DayNight.NoActionBar');

    const items: Record<string, string> = Object.fromEntries(
      Array.from(styles[0].getElementsByTagName('item')).map((i) => [
        i.getAttribute('name') ?? '',
        i.textContent?.trim() ?? '',
      ])
    );
    expect(items.colorPrimary).toBe('@color/widget_primary');
    expect(items.colorOnPrimary).toBe('@color/widget_text_on_primary');

    // Every colour the theme names has a default; the night qualifier only overrides it.
    const colours = defined(res, 'color');
    for (const value of Object.values(items)) {
      const ref = /^@color\/(.+)$/.exec(value);
      if (!ref) continue;
      expect([ref[1], colours.get('values')?.has(ref[1])]).toEqual([ref[1], true]);
    }
  });

  it('point only at strings, colours and dimensions the generated project defines', () => {
    const res = path.join(generate(), 'res');
    const kinds: Record<string, Map<string, Set<string>>> = {
      string: defined(res, 'string'),
      color: defined(res, 'color'),
      dimen: defined(res, 'dimen'),
    };
    const ids = new Set<string>();
    for (const layout of CONFIGURE_LAYOUTS) {
      const xml = fs.readFileSync(path.join(res, 'layout', layout), 'utf8');
      for (const [, id] of xml.matchAll(/@\+id\/(\w+)/g)) ids.add(id);
      for (const [, kind, name] of xml.matchAll(/@(string|color|dimen)\/(\w+)/g)) {
        expect([layout, name, kinds[kind].get('values')?.has(name)]).toEqual([layout, name, true]);
        if (kind !== 'string') continue;
        // A string a picker shows is translated in every locale the app ships.
        for (const [dir, names] of kinds.string) {
          if (names.size === 0) continue;
          expect([dir, name, names.has(name)]).toEqual([dir, name, true]);
        }
      }
    }
    // The base activity finds the toolbar and the content frame by these ids.
    expect([...ids]).toEqual(
      expect.arrayContaining(['widget_configure_toolbar', 'widget_configure_content'])
    );
  });
});

describe('the Material components dependency', () => {
  const gradle = `android {\n}\n\ndependencies {\n    implementation("com.facebook.react:react-android")\n}\n`;

  it('is added to the app dependencies', () => {
    const out = plugin.applyMaterialDependency(gradle);
    const block = out.slice(out.indexOf('dependencies {'));
    expect(block).toContain(`implementation "${plugin.MATERIAL_DEPENDENCY}"`);
    expect(plugin.MATERIAL_DEPENDENCY).toMatch(/^com\.google\.android\.material:material:\d/);
  });

  it('is added once however many times prebuild runs', () => {
    const twice = plugin.applyMaterialDependency(plugin.applyMaterialDependency(gradle));
    expect(twice.split(plugin.MATERIAL_DEPENDENCY)).toHaveLength(2);
  });

  it('refuses a build file with no dependencies block rather than writing a broken one', () => {
    expect(() => plugin.applyMaterialDependency('android {\n}\n')).toThrow(/dependencies/);
  });
});
