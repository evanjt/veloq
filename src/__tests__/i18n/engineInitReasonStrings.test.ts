/**
 * Scenario: the engine init banner names why the engine did not open. The
 * engine classifies the failure and hands over a reason; the banner turns that
 * into a line.
 *
 * Expected behaviour: every reason the banner can render has a real
 * translation in every locale. A missing one falls back to the
 * general "failed to initialise" sentence, which is the bug this replaced.
 * `Opened` and `NotAttempted` are not failures and name no line.
 */

import * as fs from 'fs';
import * as path from 'path';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

const KEYS = ['busy', 'forwardSchema', 'storageUnavailable', 'failed'] as const;

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

function reasonsOf(locale: string): Record<string, string> {
  const raw = fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf-8');
  return JSON.parse(raw).engine.initReason as Record<string, string>;
}

describe('engine init reason strings', () => {
  describe.each(locales)('%s', (locale) => {
    const reasons = reasonsOf(locale);

    it('names no reason the banner cannot render', () => {
      expect(Object.keys(reasons).sort()).toEqual([...KEYS].sort());
    });

    it('keeps the general line the fallback', () => {
      const raw = fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf-8');
      expect(typeof JSON.parse(raw).engine.initFailed).toBe('string');
    });
  });
});
