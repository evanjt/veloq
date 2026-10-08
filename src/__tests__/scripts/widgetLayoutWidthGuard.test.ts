/**
 * Scenario: a home-screen widget layout whose root is a horizontal LinearLayout holds two
 * weighted columns (0dp wide) and gains a `match_parent`-wide child beside them. The wide child
 * takes the whole row, the columns measure 0 wide, and the widget draws only that child.
 *
 * Expected behaviour: the guard fails on that shape and names the layout, and passes when the
 * wide child sits in a vertical container below the columns.
 *
 * Scenario: a widget layout gains a plain `View` as a spacer or divider, which RemoteViews refuses,
 * so the launcher shows its error card in place of the widget.
 *
 * Expected behaviour: the guard fails on it in a widget layout and passes it in a configure
 * screen, which is an ordinary activity.
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

function tree(name: string, xml: string): string {
  const root = mkdtempSync(join(tmpdir(), 'widget-layouts-'));
  roots.push(root);
  const dir = join(root, 'widget/android/res/layout');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), xml);
  return root;
}

const NS = 'xmlns:android="http://schemas.android.com/apk/res/android"';
const COLUMN = `<LinearLayout android:layout_width="0dp" android:layout_height="match_parent" android:layout_weight="1" android:orientation="vertical"><TextView android:layout_width="wrap_content" android:layout_height="wrap_content" /></LinearLayout>`;
const AGE = `<TextView android:id="@+id/age" android:layout_width="match_parent" android:layout_height="wrap_content" />`;

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

it('fails when a match_parent child sits beside weighted columns in a horizontal row', () => {
  const root = tree(
    'widget_wide.xml',
    `<LinearLayout ${NS} android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="horizontal">${COLUMN}${COLUMN}${AGE}</LinearLayout>`
  );
  const { status, output } = runGuard(root);
  expect(status).not.toBe(0);
  expect(output).toContain('widget_wide.xml');
});

it('fails on a row with no orientation, which Android reads as horizontal', () => {
  const root = tree(
    'widget_default.xml',
    `<LinearLayout ${NS} android:layout_width="match_parent" android:layout_height="match_parent">${COLUMN}${AGE}</LinearLayout>`
  );
  expect(runGuard(root).status).not.toBe(0);
});

it('passes when the wide child sits in a vertical container below the columns', () => {
  const root = tree(
    'widget_ok.xml',
    `<LinearLayout ${NS} android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical"><LinearLayout android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="horizontal">${COLUMN}${COLUMN}</LinearLayout>${AGE}</LinearLayout>`
  );
  expect(runGuard(root).status).toBe(0);
});

it('passes when the wide child is itself weighted', () => {
  const root = tree(
    'widget_weighted.xml',
    `<LinearLayout ${NS} android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="horizontal">${COLUMN}<TextView android:layout_width="match_parent" android:layout_height="wrap_content" android:layout_weight="1" /></LinearLayout>`
  );
  expect(runGuard(root).status).toBe(0);
});

const SPACER = `<View android:layout_width="match_parent" android:layout_height="0dp" android:layout_weight="1" />`;

it('fails on a plain View in a widget layout, which a launcher refuses to inflate', () => {
  const root = tree(
    'widget_spacer.xml',
    `<LinearLayout ${NS} android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical">${AGE}${SPACER}</LinearLayout>`
  );
  const { status, output } = runGuard(root);
  expect(status).not.toBe(0);
  expect(output).toContain('widget_spacer.xml: View');
});

it('passes the same spacer as a FrameLayout', () => {
  const root = tree(
    'widget_frame.xml',
    `<LinearLayout ${NS} android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical">${AGE}${SPACER.replace('<View', '<FrameLayout')}</LinearLayout>`
  );
  expect(runGuard(root).status).toBe(0);
});

it('passes a plain View in a configure screen, which is an ordinary activity', () => {
  const root = tree(
    'widget_summary_configure.xml',
    `<LinearLayout ${NS} android:layout_width="match_parent" android:layout_height="match_parent" android:orientation="vertical">${AGE}${SPACER}</LinearLayout>`
  );
  expect(runGuard(root).status).toBe(0);
});
