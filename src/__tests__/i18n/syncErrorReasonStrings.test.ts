/**
 * Scenario: the sync banner names why a sync failed. The engine classifies the
 * failure and hands over a reason; the banner turns that into a line.
 *
 * Expected behaviour: every reason the engine can produce has a real
 * translation in all seventeen locales. A missing one falls back to the
 * engine's own English, which is the bug this replaced.
 */

import * as fs from 'fs';
import * as path from 'path';

import { SyncErrorReason } from '../__shared__/veloqrsStub';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

const KEYS = [
  'unauthorized',
  'rateLimited',
  'server',
  'network',
  'storage',
  'notConfigured',
  'internal',
] as const;

const ENGLISH_LOCALES = ['en-AU', 'en-GB', 'en-US'];

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

function reasonsOf(locale: string): Record<string, string> {
  const raw = fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf-8');
  return JSON.parse(raw).emptyState.syncError.reason as Record<string, string>;
}

describe('sync error reason strings', () => {
  it('covers all 17 locales', () => {
    expect(locales).toHaveLength(17);
  });

  it('has a key for every reason the engine can produce', () => {
    const members = Object.values(SyncErrorReason).filter((v) => typeof v === 'number');
    expect(KEYS).toHaveLength(members.length);
  });

  describe.each(locales)('%s', (locale) => {
    const reasons = reasonsOf(locale);

    it.each(KEYS)('defines %s', (key) => {
      expect(typeof reasons[key]).toBe('string');
      expect(reasons[key].trim().length).toBeGreaterThan(0);
    });

    it('names no reason the engine cannot produce', () => {
      expect(Object.keys(reasons).sort()).toEqual([...KEYS].sort());
    });

    if (!ENGLISH_LOCALES.includes(locale)) {
      it('translates the prose rather than copying English', () => {
        const english = reasonsOf('en-GB');
        const copied = KEYS.filter((k) => reasons[k] === english[k]);
        expect(copied).toEqual([]);
      });
    }
  });
});
