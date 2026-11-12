/**
 * Scenario: the connect page reads the browser's language list and must pick
 * the same bundle the app would for that tag.
 *
 * Expected behaviour: the first listed language the app can speak decides; a
 * regional tag walks the app's own fallback chain; a language nothing matches
 * lands on en-GB.
 */

import { resolveLocaleChain } from '@/i18n/resolveLocale';
import { SUPPORTED_LOCALES } from '@/i18n/types';

describe('resolveLocaleChain', () => {
  it.each([
    [['de-CH', 'fr'], 'de-CH'],
    [['en-NZ'], 'en-AU'],
    [['pt-PT'], 'pt'],
    [['xx'], 'en-GB'],
    [[], 'en-GB'],
    [['FR-ca'], 'fr'],
    [['zh-TW', 'ja'], 'zh-Hans'],
    [['xx', 'ja-JP'], 'ja'],
  ])('%j picks %s', (languages, picked) => {
    expect(resolveLocaleChain(languages)[0]).toBe(picked);
  });

  it('ends every chain at en-GB', () => {
    for (const tag of [...SUPPORTED_LOCALES, 'xx', 'es-MX', 'fr-CH']) {
      const chain = resolveLocaleChain([tag]);
      expect(chain[chain.length - 1]).toBe('en-GB');
    }
  });

  it('gives a supported tag its own chain', () => {
    expect(resolveLocaleChain(['de-CH'])).toEqual(['de-CH', 'de-DE', 'en-GB']);
  });
});
