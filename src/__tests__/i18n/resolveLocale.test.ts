/**
 * Scenario: the connect page reads the browser's language list and must pick
 * the same bundle the app would for that tag.
 *
 * Expected behaviour: the first listed language the app can speak decides; a
 * regional tag walks the app's own fallback chain; a language nothing matches
 * lands on en-GB. The app's device match and the page's browser match name the
 * same locale for every tag, so the picker's Spanish default applies on both.
 */

import { matchLocale } from '@/i18n';
import { resolveLocaleChain } from '@/i18n/resolveLocale';
import { LOCALE_FALLBACKS, SUPPORTED_LOCALES } from '@/i18n/types';

describe('resolveLocaleChain', () => {
  vaultIt.each([
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

  vaultIt('gives a supported tag its own chain', () => {
    expect(resolveLocaleChain(['de-CH'])).toEqual(['de-CH', 'de-DE', 'en-GB']);
  });

  it('gives a bare Spanish tag the Latin American chain the picker defaults to', () => {
    expect(resolveLocaleChain(['es'])).toEqual(['es-419', 'es', 'en-GB']);
  });
});

describe('the app and the connect page pick the same locale', () => {
  const tags = [
    'es',
    'es-US',
    'es-UY',
    'es-419',
    'es-ES',
    'es-MX',
    'FR-ca',
    'zh-Hans-CN',
    'pt-PT',
    'en-NZ',
    'xx',
  ];

  it.each(tags)('%s resolves to the same first locale in both', (tag) => {
    expect(resolveLocaleChain([tag])[0]).toBe(matchLocale([{ languageTag: tag }]));
  });

  it('agrees for every key of the fallback table', () => {
    for (const tag of Object.keys(LOCALE_FALLBACKS)) {
      expect({ tag, page: resolveLocaleChain([tag])[0] }).toEqual({
        tag,
        page: matchLocale([{ languageTag: tag }]),
      });
    }
  });
});
