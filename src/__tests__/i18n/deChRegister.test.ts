/**
 * Scenario: de-CH errors, failure messages and the buttons every dialog
 * shares are tongue in cheek: oaths are allowed, funny rather than hostile.
 * de-DE stays plain, so a Swiss reader who prefers it keeps that escape.
 *
 * Expected behaviour: a Swiss oath in de-DE or in any locale other than
 * de-CH fails this suite, and de-CH keeps its oaths on the error titles.
 */
import fs from 'fs';
import path from 'path';
import deCH from '@/i18n/locales/de-CH.json';

const OATH = /gopferteckel|siech/i;
const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

function flatten(node: unknown, p: string[] = []): [string, string][] {
  if (typeof node === 'string') return [[p.join('.'), node]];
  if (node === null || typeof node !== 'object') return [];
  return Object.entries(node as Record<string, unknown>).flatMap(([k, v]) => flatten(v, [...p, k]));
}

const plainLocales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json') && f !== 'de-CH.json');

describe('de-CH register', () => {
  it.each(plainLocales)('%s carries no Swiss oath', (file) => {
    const locale = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), 'utf8'));
    const offenders = flatten(locale)
      .filter(([, value]) => OATH.test(value))
      .map(([key, value]) => `${key}: ${value}`);
    expect(offenders).toEqual([]);
  });

  it('keeps the oath on the shared error titles', () => {
    const ch = new Map(flatten(deCH));
    expect(ch.get('common.error')).toMatch(OATH);
    expect(ch.get('alerts.error')).toMatch(OATH);
    expect(ch.get('errorState.defaultTitle')).toMatch(OATH);
  });

  it('clear cache confirmation names the activity data, tracks and route matching it deletes', () => {
    const ch = new Map(flatten(deCH));
    const message = ch.get('alerts.clearCacheMessage') ?? '';
    expect(message).toMatch(/Aktivitäts?date/i);
    expect(message).toMatch(/spure?/i);
    expect(message).toMatch(/Routeabgleich|Routenabgleich/i);
  });
});
