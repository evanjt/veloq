/**
 * The session-expiry notice ships five strings. Every locale needs all of
 * them, the athlete line has to keep its placeholder, and none of it may sit
 * there in English. The two event lines name only the event now, so a
 * translation carrying the old "please sign in again" tail would say it twice.
 */

import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

const KEYS = [
  'sessionExpired',
  'sessionRevoked',
  'sessionDataKept',
  'sessionRestore',
  'sessionRestoreAthlete',
] as const;

const ENGLISH_LOCALES = ['en-AU', 'en-GB', 'en-US'];

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

function loginOf(locale: string): Record<string, string> {
  const raw = fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf-8');
  return JSON.parse(raw).login as Record<string, string>;
}

describe('session expiry strings', () => {
  it('covers all 17 locales', () => {
    expect(locales).toHaveLength(17);
  });

  describe.each(locales)('%s', (locale) => {
    const login = loginOf(locale);

    it.each(KEYS)('defines %s', (key) => {
      expect(typeof login[key]).toBe('string');
      expect(login[key].trim().length).toBeGreaterThan(0);
    });

    it('keeps the athlete placeholder', () => {
      expect(login.sessionRestoreAthlete).toContain('{{athleteId}}');
    });

    it('leaves the sign-in instruction to the restore line', () => {
      expect(login.sessionExpired).not.toContain(login.sessionRestore);
      expect(login.sessionRevoked).not.toContain(login.sessionRestore);
    });

    if (!ENGLISH_LOCALES.includes(locale)) {
      it('translates the prose rather than copying English', () => {
        const english = loginOf('en-GB');
        const copied = KEYS.filter((k) => login[k] === english[k]);
        expect(copied).toEqual([]);
      });
    }
  });
});
