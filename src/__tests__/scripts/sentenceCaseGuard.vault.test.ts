/**
 * Scenario: an English label is written in title case beside sentence-case
 * ones, so the same term reads two ways on one screen.
 *
 * Expected behaviour: the guard fails on a capitalised word after the first,
 * or after a hyphen, and names the key. Proper nouns, acronyms, a word after a
 * full stop, cited titles, activity type names and full sentences pass, and
 * other languages are not read.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-sentence-case.mjs');

function run(root: string): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, '--root', root], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

describe('sentence-case label guard', () => {
  const roots: string[] = [];
  afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

  const withLocale = (strings: unknown, file = 'en-GB.json') => {
    const root = mkdtempSync(join(tmpdir(), 'sentence-case-'));
    roots.push(root);
    const dir = join(root, 'src/i18n/locales');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), JSON.stringify(strings));
    return root;
  };

  it.each([
    ['Edit Bounds', 'Bounds'],
    ['Local Data Range', 'Data'],
    ['Time in HR Zones', 'Zones'],
    ['{{count}} Activities', 'Activities'],
    ['Local mode: No server is involved', 'No'],
    ['Auto-Pause', 'Auto-Pause'],
  ])('fails on %s', (label, word) => {
    const result = run(withLocale({ sections: { editBounds: label } }));
    expect(result.status).toBe(1);
    expect(result.output).toContain('sections.editBounds');
    expect(result.output).toContain(word);
  });

  it('fails in a nested key of a regional English locale', () => {
    const result = run(withLocale({ a: { b: { title: 'Third-Party Licenses' } } }, 'en-US.json'));
    expect(result.status).toBe(1);
    expect(result.output).toContain('a.b.title');
  });

  it('passes sentence case, proper nouns, acronyms and a new sentence', () => {
    const result = run(
      withLocale({
        a: 'Edit bounds',
        b: 'GPS accuracy',
        c: 'Restore from Google Drive',
        d: 'Sign in with intervals.icu',
        e: 'Synced {{count}} activities. Still analysing routes',
        f: 'eFTP trend',
        g: 'Open Veloq to refresh',
        h: 'Heart rate',
        i: 'Backup set-up: WebDAV login and OAuth token',
        j: 'Tap Retry to load it again.',
      })
    );
    expect(result.output).not.toContain('Edit bounds');
    expect(result.status).toBe(0);
  });

  it('leaves activity type names and cited titles alone', () => {
    const result = run(
      withLocale({
        activityTypes: { GravelRide: 'Gravel Ride' },
        fitnessScreen: { linkTrainingLoad: 'Monitoring Training Load (an article)' },
      })
    );
    expect(result.status).toBe(0);
  });

  it('ignores locales that are not English', () => {
    const result = run(withLocale({ a: 'Abschnitt Wiederherstellen' }, 'de-DE.json'));
    expect(result.status).toBe(0);
  });
});
