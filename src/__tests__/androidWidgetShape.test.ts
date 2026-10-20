/**
 * Scenario: a widget is placed on an Android 12 or later launcher whose widget corners are rounder
 * than the app's own 16dp.
 *
 * Expected behaviour: the widget takes the launcher's corner radius rather than a fixed one, and
 * every surface a launcher draws marks its root as the system background and clips to it, so the
 * corners match the system widgets beside it and the launch transition can start from the widget.
 * Below Android 12 the fixed radius stays.
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-shape-'));
  dirs.push(root);
  plugin.writeWidgetSources(projectRoot, root, PKG);
  return path.join(root, 'app', 'src', 'main', 'res');
}

function rootOf(file: string): Element {
  return new DOMParser().parseFromString(fs.readFileSync(file, 'utf8'), 'text/xml').documentElement;
}

function dimens(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  const list = rootOf(file).getElementsByTagName('dimen');
  for (let i = 0; i < list.length; i++) {
    out[list[i].getAttribute('name') ?? ''] = list[i].textContent ?? '';
  }
  return out;
}

const SURFACES = ['@drawable/widget_background'];

/** Every layout a provider info names, and every layout whose root draws a widget surface. */
function launcherLayouts(res: string): string[] {
  const named = new Set<string>();
  for (const file of fs.readdirSync(path.join(res, 'xml'))) {
    const info = rootOf(path.join(res, 'xml', file));
    if (info.tagName !== 'appwidget-provider') continue;
    for (const key of ['android:initialLayout', 'android:previewLayout']) {
      const ref = info.getAttribute(key);
      if (ref) named.add(ref.replace('@layout/', ''));
    }
  }
  for (const file of fs.readdirSync(path.join(res, 'layout'))) {
    const background = rootOf(path.join(res, 'layout', file)).getAttribute('android:background');
    if (background && SURFACES.includes(background)) named.add(file.replace(/\.xml$/, ''));
  }
  return [...named].sort();
}

describe('the Android widget shape', () => {
  it('takes the launcher corner radii from Android 12 and keeps the fixed radius below it', () => {
    const res = generate();
    const v31 = path.join(res, 'values-v31', 'widget_theme.xml');
    expect(fs.existsSync(v31)).toBe(true);
    expect(dimens(v31)).toEqual({
      widget_radius: '@android:dimen/system_app_widget_background_radius',
      widget_radius_inner: '@android:dimen/system_app_widget_inner_radius',
    });
    const base = dimens(path.join(res, 'values', 'widget_theme.xml'));
    expect(base.widget_radius).toMatch(/^\d+dp$/);
    expect(base.widget_radius_inner).toMatch(/^\d+dp$/);
  });

  it('marks the root of every launcher layout as the system background and clips to it', () => {
    const res = generate();
    const layouts = launcherLayouts(res);
    expect(layouts).toEqual(
      expect.arrayContaining([
        'widget_small',
        'widget_short',
        'widget_medium',
        'widget_large',
        'widget_activity_small',
        'widget_activity_medium',
        'widget_insights',
        'widget_insights_short',
        'widget_strength',
        'widget_strength_small',
        'widget_preview_summary',
      ])
    );
    const unmarked = layouts.filter((name) => {
      const root = rootOf(path.join(res, 'layout', `${name}.xml`));
      return (
        root.getAttribute('android:id') !== '@android:id/background' ||
        root.getAttribute('android:clipToOutline') !== 'true'
      );
    });
    expect(unmarked).toEqual([]);
  });
});
