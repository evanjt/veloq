/**
 * Scenario: the store screenshot run captures the app once per language and
 * installs each set into every store locale that shows it. A store locale no
 * capture covers keeps whatever the store last held, and a capture that asks
 * the app for a language its picker does not offer is taken in the wrong one.
 *
 * Expected behaviour: every Play and App Store locale is installed from exactly
 * one capture, en-CA on the App Store included, a mirror is never captured on
 * its own, and every capture selects a language the app's picker offers.
 */

import { getAvailableLanguages } from '@/shared/app/LanguageStore';

import { MIRRORS, captureLocales, uniqueStoreLocales } from '../../../scripts/store-locales';

function pickerValues(): string[] {
  return getAvailableLanguages()
    .flatMap((group) => group.languages)
    .flatMap((lang) => (lang.variants ? lang.variants.map((v) => v.value) : [lang.value]));
}

describe('captureLocales', () => {
  const captures = captureLocales();

  it.each(['android', 'ios'] as const)('installs every %s store locale from one capture', (p) => {
    const installed = captures.flatMap((c) => c[p]);
    expect([...installed].sort()).toEqual([...uniqueStoreLocales(p)].sort());
    expect(new Set(installed).size).toBe(installed.length);
  });

  it('fills the App Store English (Canada) listing, which no app locale stands behind', () => {
    expect(captures.find((c) => c.ios.includes('en-CA'))?.play).toBe('en-US');
  });

  it('captures a mirror only through the locale it mirrors', () => {
    const mirrored = Object.values(MIRRORS).flat();
    expect(captures.map((c) => c.play).filter((p) => mirrored.includes(p))).toEqual([]);
    expect(captures.find((c) => c.play === 'en-AU')?.android).toEqual(['en-AU', 'en-GB']);
  });

  it('selects a language the app picker offers, in the store locale own variant', () => {
    const offered = pickerValues();
    for (const capture of captures) expect(offered).toContain(capture.app);
    const app = Object.fromEntries(captures.map((c) => [c.play, c.app]));
    expect(app).toMatchObject({
      'es-ES': 'es-ES',
      'es-419': 'es-419',
      'pt-PT': 'pt',
      'de-DE': 'de-DE',
    });
  });
});
