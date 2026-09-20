/**
 * Scenario: seventeen locale bundles were static imports built into one
 * `resources` object at module evaluation, so every launch materialised about
 * 1.5 MB of object literals on the JS thread whichever locale the athlete reads.
 *
 * Expected behaviour: a launch loads the athlete's locale, whatever its fallback
 * chain names, and the root. Switching locales loads that one before the switch,
 * so no key reads as itself.
 */

import { localesToLoad, loadLocale, loadableLocales, ROOT_LOCALE } from '@/i18n/localeBundles';
import { initializeI18n, changeLanguage, i18n } from '@/i18n';

describe('which locales a launch has to load', () => {
  it('is the locale, its chain and the root, in consultation order', () => {
    expect(localesToLoad('es-ES')).toEqual(['es-ES', 'es', 'en-GB']);
  });

  it('names each locale once', () => {
    const chain = localesToLoad('en-AU');
    expect(chain).toEqual([...new Set(chain)]);
    expect(chain).toEqual(['en-AU', 'en-GB']);
  });

  it('always ends at the root, so a missing key is read and not shown', () => {
    for (const locale of loadableLocales()) {
      expect(localesToLoad(locale)).toContain(ROOT_LOCALE);
    }
  });

  it('drops a regional tag that has no bundle of its own', () => {
    // `en-NZ` resolves to the Australian file; there is no en-NZ.json.
    expect(localesToLoad('en-NZ')).toEqual(['en-AU', 'en-GB']);
    expect(localesToLoad('es-MX')).toEqual(['es-419', 'es', 'en-GB']);
  });

  it('is the root alone for a locale nothing knows', () => {
    expect(localesToLoad('xx-YY')).toEqual([ROOT_LOCALE]);
  });

  it('is far short of every locale, which is the point', () => {
    expect(localesToLoad('ja').length).toBeLessThan(loadableLocales().length);
  });
});

describe('loading one bundle', () => {
  it('hands back a populated object', () => {
    const bundle = loadLocale('en-GB');
    expect(Object.keys(bundle).length).toBeGreaterThan(0);
  });

  it('hands back the same object on a second call, the module being cached', () => {
    expect(loadLocale('ja')).toBe(loadLocale('ja'));
  });
});

describe('the store a launch leaves behind', () => {
  it('holds the launch locale and its chain and not the other fourteen', async () => {
    await initializeI18n('de-CH');

    for (const needed of localesToLoad('de-CH')) {
      expect(i18n.hasResourceBundle(needed, 'translation')).toBe(true);
    }
    expect(i18n.hasResourceBundle('ja', 'translation')).toBe(false);
    expect(i18n.hasResourceBundle('pl', 'translation')).toBe(false);
  });

  it('translates into a locale it did not launch with, after the switch', async () => {
    await initializeI18n('en-GB');
    expect(i18n.hasResourceBundle('ja', 'translation')).toBe(false);

    await changeLanguage('ja');

    expect(i18n.hasResourceBundle('ja', 'translation')).toBe(true);
    expect(i18n.language).toBe('ja');
    // A real key, resolved rather than echoed back.
    const translated = i18n.t('common.cancel');
    expect(translated).not.toBe('common.cancel');
    expect(translated.length).toBeGreaterThan(0);
  });

  it('keeps the previous locale loaded, so switching back costs nothing', async () => {
    await initializeI18n('en-GB');
    await changeLanguage('ja');
    await changeLanguage('en-GB');

    expect(i18n.hasResourceBundle('ja', 'translation')).toBe(true);
    expect(i18n.hasResourceBundle('en-GB', 'translation')).toBe(true);
  });
});
