/**
 * Scenario: a widget layout gains a TextView that names no family, so a launcher draws it in the
 * phone's own sans beside labels drawn in the app's face.
 *
 * Expected behaviour: the guard fails on every TextView whose `android:fontFamily` is not the
 * widget family and names the layout and the view, and passes a layout whose every TextView
 * names it, a configure screen included.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { gitFreeEnv } from '../__shared__/gitFixture';

const SCRIPT = join(__dirname, '../../../scripts/lint-widget-face.mjs');

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

function tree(layouts: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'widget-face-'));
  roots.push(root);
  const dir = join(root, 'widget/android/res/layout');
  mkdirSync(dir, { recursive: true });
  for (const [name, xml] of Object.entries(layouts)) writeFileSync(join(dir, name), xml);
  return root;
}

const NS = 'xmlns:android="http://schemas.android.com/apk/res/android"';
const label = (id: string, family?: string) =>
  `<TextView android:id="@+id/${id}" android:layout_width="wrap_content" android:layout_height="wrap_content"${
    family === undefined ? '' : ` android:fontFamily="${family}"`
  } android:textStyle="bold" />`;
const column = (...children: string[]) =>
  `<LinearLayout ${NS} android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical">${children.join('')}</LinearLayout>`;

it('fails on a TextView that names no family, naming the layout and the view', () => {
  const root = tree({
    'widget_tide.xml': column(label('tide_height', '@font/widget_manrope'), label('tide_time')),
  });
  const { status, output } = runGuard(root);
  expect(status).not.toBe(0);
  expect(output).toContain('widget_tide.xml: TextView @+id/tide_time');
  expect(output).not.toContain('tide_height');
});

it('fails on a TextView that names a platform family', () => {
  const root = tree({ 'widget_tide.xml': column(label('tide_time', 'sans-serif-medium')) });
  const { status, output } = runGuard(root);
  expect(status).not.toBe(0);
  expect(output).toContain('tide_time');
});

it('fails on a TextView in a configure screen too, nested in its layout', () => {
  const root = tree({
    'widget_tide_configure.xml': column(column(label('tide_pick'))),
  });
  expect(runGuard(root).output).toContain('widget_tide_configure.xml: TextView @+id/tide_pick');
});

it('passes when every TextView names the widget family', () => {
  const root = tree({
    'widget_tide.xml': column(
      label('tide_height', '@font/widget_manrope'),
      column(label('tide_time', '@font/widget_manrope'))
    ),
  });
  expect(runGuard(root).status).toBe(0);
});
