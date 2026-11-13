/**
 * Scenario: a widget that cannot be resized is drawn in the one cell its info declares. A layout
 * whose padding, glyph and label add up to more than that cell is clipped by the host, and a
 * label at a fixed text size clips again in a language whose word is longer than the English.
 *
 * Expected behaviour: the guard names a fixed-size layout that does not fit its declared minimum
 * cell, or whose label cannot shrink, and passes one that fits and shrinks.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-widget-layouts.mjs');

function runGuard(root: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, '--root', root], {
      env: gitFreeEnv(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const NS = 'xmlns:android="http://schemas.android.com/apk/res/android"';

const DIMENS = `<resources>
  <dimen name="widget_padding">16dp</dimen>
  <dimen name="widget_gap">8dp</dimen>
  <dimen name="widget_text_value">18sp</dimen>
  <dimen name="widget_text_caption">10sp</dimen>
  <dimen name="widget_tile_padding">4dp</dimen>
  <dimen name="widget_tile_glyph">24dp</dimen>
  <dimen name="widget_tile_gap">2dp</dimen>
  <dimen name="widget_tile_text_min">7sp</dimen>
</resources>`;

function info(resizeMode: string): string {
  return `<appwidget-provider ${NS} android:minWidth="57dp" android:minHeight="57dp" android:resizeMode="${resizeMode}" android:initialLayout="@layout/widget_tile" />`;
}

function tree(layout: string, resizeMode = 'none'): string {
  const root = mkdtempSync(join(tmpdir(), 'widget-cell-'));
  roots.push(root);
  const res = join(root, 'widget/android/res');
  for (const sub of ['layout', 'values', 'xml']) mkdirSync(join(res, sub), { recursive: true });
  writeFileSync(join(res, 'layout/widget_tile.xml'), layout);
  writeFileSync(join(res, 'values/widget_theme.xml'), DIMENS);
  writeFileSync(join(res, 'xml/widget_tile_info.xml'), info(resizeMode));
  return root;
}

const TALL = `<LinearLayout ${NS} android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical" android:gravity="center" android:padding="@dimen/widget_padding"><ImageView android:layout_width="44dp" android:layout_height="44dp" /><TextView android:layout_width="wrap_content" android:layout_height="wrap_content" android:layout_marginTop="@dimen/widget_gap" android:textSize="@dimen/widget_text_value" /></LinearLayout>`;

const FITS = `<LinearLayout ${NS} android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical" android:gravity="center" android:padding="@dimen/widget_tile_padding"><ImageView android:layout_width="@dimen/widget_tile_glyph" android:layout_height="@dimen/widget_tile_glyph" /><TextView android:layout_width="match_parent" android:layout_height="16dp" android:layout_marginTop="@dimen/widget_tile_gap" android:textSize="@dimen/widget_text_caption" android:maxLines="1" android:autoSizeTextType="uniform" android:autoSizeMinTextSize="@dimen/widget_tile_text_min" android:autoSizeMaxTextSize="@dimen/widget_text_caption" /></LinearLayout>`;

it('fails when a fixed-size layout is taller than its declared cell', () => {
  const { status, output } = runGuard(tree(TALL));
  expect(status).not.toBe(0);
  expect(output).toContain('widget_tile.xml');
  expect(output).toContain('57dp');
});

it('fails when a label in a fixed-size layout cannot shrink to a longer translation', () => {
  const root = tree(
    FITS.replace(' android:autoSizeTextType="uniform"', '').replace(
      /android:autoSize(Min|Max)TextSize="[^"]*"/g,
      ''
    )
  );
  const { status, output } = runGuard(root);
  expect(status).not.toBe(0);
  expect(output).toContain('autoSizeTextType');
});

it('fails when a fixed-size glyph is wider than its declared cell', () => {
  const root = tree(FITS.replace(/@dimen\/widget_tile_glyph/g, '60dp'));
  expect(runGuard(root).status).not.toBe(0);
});

it('fails when a size in a fixed-size layout names a dimension nobody declared', () => {
  const root = tree(FITS.replace(/@dimen\/widget_tile_glyph/g, '@dimen/widget_missing'));
  const { status, output } = runGuard(root);
  expect(status).not.toBe(0);
  expect(output).toContain('widget_missing');
});

it('passes a fixed-size layout that fits its cell and shrinks its label', () => {
  expect(runGuard(tree(FITS)).status).toBe(0);
});

it('leaves a resizable layout to the host, which grows it to fit', () => {
  expect(runGuard(tree(TALL, 'horizontal|vertical')).status).toBe(0);
});

it('counts a fixed label height against the cell', () => {
  const root = tree(FITS.replace('android:layout_height="16dp"', 'android:layout_height="30dp"'));
  expect(runGuard(root).status).not.toBe(0);
});
