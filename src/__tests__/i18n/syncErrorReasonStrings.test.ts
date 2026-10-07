/**
 * Scenario: the sync banner names why a sync failed. The engine classifies the
 * failure and hands over a reason; the banner turns that into a line.
 *
 * Expected behaviour: every reason the engine can produce has a real
 * translation in every locale. A missing one falls back to the
 * engine's own English, which is the bug this replaced.
 */

import { resolvedLocale } from './resolvedLocale';
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
  'engineClosed',
] as const;

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

function reasonsOf(locale: string): Record<string, string> {
  return resolvedLocale(locale).emptyState.syncError.reason as Record<string, string>;
}

describe('sync error reason strings', () => {
  it('has a key for every reason the engine can produce', () => {
    const members = Object.values(SyncErrorReason).filter((v) => typeof v === 'number');
    expect(KEYS).toHaveLength(members.length);
  });

  describe.each(locales)('%s', (locale) => {
    const reasons = reasonsOf(locale);

    it('names no reason the engine cannot produce', () => {
      expect(Object.keys(reasons).sort()).toEqual([...KEYS].sort());
    });
  });
});
