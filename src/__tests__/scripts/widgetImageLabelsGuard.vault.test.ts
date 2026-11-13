import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SCRIPT = resolve(__dirname, '../../../scripts/lint-widget-image-labels.mjs');

function image(attrs: string): string {
  return `<ImageView android:layout_width="8dp" android:layout_height="8dp" ${attrs} />`;
}

function check(layout: string, code = ''): { status: number | null; output: string } {
  const root = mkdtempSync(join(tmpdir(), 'widget-image-labels-'));
  try {
    mkdirSync(join(root, 'widget/android/res/layout'), { recursive: true });
    mkdirSync(join(root, 'widget/android/java'), { recursive: true });
    writeFileSync(
      join(root, 'widget/android/res/layout/widget_trail.xml'),
      `<LinearLayout>\n${layout}\n</LinearLayout>\n`
    );
    writeFileSync(join(root, 'widget/android/java/TrailRenderer.kt'), code);
    const result = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
    if (result.error) throw result.error;
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('widget image labels', () => {
  it('refuses an image with a null description that nothing describes', () => {
    const result = check(image('android:id="@+id/trail_map" android:contentDescription="@null"'));
    expect(result.status).toBe(1);
    expect(result.output).toContain('widget_trail.xml:2: trail_map says nothing');
  });

  it('refuses an unnamed image with no description', () => {
    const result = check(image('android:src="@drawable/trail_glyph"'));
    expect(result.status).toBe(1);
    expect(result.output).toContain('an unnamed ImageView says nothing');
  });

  it('accepts an image marked as saying nothing', () => {
    expect(check(image('android:importantForAccessibility="no"')).status).toBe(0);
  });

  it('accepts an image whose layout describes it', () => {
    expect(check(image('android:contentDescription="@string/trail_map"')).status).toBe(0);
  });

  it('accepts an image the code describes by its id', () => {
    const code = 'v.setContentDescription(R.id.trail_map, snap.trailLabel)';
    expect(check(image('android:id="@+id/trail_map"'), code).status).toBe(0);
  });

  it('accepts an image the code describes through an id holder', () => {
    const code = [
      'private class RowIds(val row: Int, val dot: Int)',
      'private val ROWS = arrayOf(RowIds(R.id.trail_row0, R.id.trail_dot0))',
      'for (ids in ROWS) v.setContentDescription(ids.dot, row.toneLabel)',
    ].join('\n');
    expect(check(image('android:id="@+id/trail_dot0"'), code).status).toBe(0);
  });

  it('refuses a holder field the code never describes', () => {
    const code = [
      'private class RowIds(val row: Int, val dot: Int)',
      'private val ROWS = arrayOf(RowIds(R.id.trail_row0, R.id.trail_dot0))',
      'for (ids in ROWS) v.setContentDescription(ids.row, row.title)',
    ].join('\n');
    const result = check(image('android:id="@+id/trail_dot0"'), code);
    expect(result.status).toBe(1);
    expect(result.output).toContain('trail_dot0 says nothing');
  });

  it('refuses a tree with no widget layouts rather than reporting it clean', () => {
    const root = mkdtempSync(join(tmpdir(), 'widget-image-labels-'));
    try {
      const result = spawnSync(process.execPath, [SCRIPT, '--root', root], { encoding: 'utf8' });
      expect(result.status).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toMatch(/read nothing/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
