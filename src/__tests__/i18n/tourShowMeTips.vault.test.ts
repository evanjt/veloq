/**
 * Scenario: a tour slide offers Show Me and the athlete taps it. The tour
 * navigates to the feature and leaves the return pill on screen.
 *
 * Expected behaviour: every slide that offers Show Me lands with a tip on that
 * pill saying what to do there, in every locale. A slide that navigated with no
 * tip left the athlete on a screen with nothing to try.
 */
import { resolvedLocale } from './resolvedLocale';
import * as fs from 'fs';
import * as path from 'path';
import { getAllSlides, getTutorialSlides } from '@/features/settings/components/whatsNew/slides';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');
const ENGLISH = /^en(-|$)/;

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

const showMeSlides = [...new Set([...getTutorialSlides(), ...getAllSlides()])].filter(
  (slide) => slide.showMeRoute !== undefined
);

function lookup(bundle: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      bundle
    );
}

describe('the tour Show Me tips', () => {
  it('gives every slide that offers Show Me a tip', () => {
    const missing = showMeSlides
      .filter((slide) => slide.showMeTip === undefined)
      .map((slide) => slide.titleKey);
    expect(missing).toEqual([]);
  });

  it('gives each landing its own tip', () => {
    const tips = showMeSlides.map((slide) => slide.showMeTip);
    expect(new Set(tips).size).toBe(tips.length);
  });

  describe.each(locales)('%s', (locale) => {
    const bundle = resolvedLocale(locale);
    const reference = resolvedLocale('en-GB');

    it.each(showMeSlides.map((slide) => [slide.titleKey, slide.showMeTip ?? '']))(
      'has a translated tip for %s',
      (_title, tipKey) => {
        const tip = lookup(bundle, tipKey);
        expect(`${locale} ${typeof tip}`).toBe(`${locale} string`);
        expect((tip as string).trim().length).toBeGreaterThan(0);
        if (!ENGLISH.test(locale)) {
          expect(`${locale} ${tip as string}`).not.toBe(
            `${locale} ${lookup(reference, tipKey) as string}`
          );
        }
      }
    );
  });
});
