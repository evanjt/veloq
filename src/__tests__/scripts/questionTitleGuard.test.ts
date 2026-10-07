/**
 * Scenario: a settings group header or an info title is written as a clause
 * that opens with a question word instead of a noun.
 *
 * Expected behaviour: the guard fails on a short English label that opens with
 * a question word and names its key. Sentences, questions and labels that open
 * with another word pass.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/lint-question-titles.mjs');

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

describe('question-word title guard', () => {
  const roots: string[] = [];
  afterAll(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

  const withLocale = (strings: unknown, file = 'en-AU.json') => {
    const root = mkdtempSync(join(tmpdir(), 'question-titles-'));
    roots.push(root);
    const dir = join(root, 'src/i18n/locales');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, file), JSON.stringify(strings));
    return root;
  };

  it.each(['What it shows me', 'Why this card was chosen', 'How balance is measured'])(
    'fails on %s',
    (label) => {
      const result = run(withLocale({ settings: { groupShows: label } }));
      expect(result.status).toBe(1);
      expect(result.output).toContain('settings.groupShows');
    }
  );

  it('fails in a nested key of another English locale', () => {
    const result = run(withLocale({ a: { b: { title: 'Which one' } } }, 'en-GB.json'));
    expect(result.status).toBe(1);
    expect(result.output).toContain('a.b.title');
  });

  it('passes nouns, questions and full sentences', () => {
    const result = run(
      withLocale({
        a: 'Appearance',
        b: 'Whatever you like',
        c: 'Why is elevation missing?',
        d: 'What it shows is set by the plan you chose in the last step.',
        e: 'How it works.',
      })
    );
    expect(result.status).toBe(0);
  });

  it('ignores locales that are not English', () => {
    const result = run(withLocale({ a: 'Was sie anzeigt', b: 'What' }, 'de-DE.json'));
    expect(result.status).toBe(0);
  });
});
