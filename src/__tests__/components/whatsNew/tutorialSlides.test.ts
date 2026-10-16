/**
 * Scenario: an athlete signs in for the first time. The tour opens while the first load is still
 * running, over a library with no activities, sections or routes yet.
 *
 * Expected behaviour: the tour is its own list, in the order the athlete meets things, opening on
 * what Veloq reads and that the first load is running, and carrying no release-only slide such as
 * the section preview. A slide whose Show Me would land on a screen with nothing in it offers no
 * Show Me until that screen holds data.
 */
import * as fs from 'fs';
import * as path from 'path';
import { resolvedLocale } from '../../i18n/resolvedLocale';
import { getAllSlides, getTutorialSlides } from '@/features/settings/components/whatsNew/slides';
import { resolveShowMeRoute, type TourLibrary } from '@/features/settings/lib/tourShowMe';

const LOCALES_DIR = path.join(__dirname, '../../../i18n/locales');
const ENGLISH = /^en(-|$)/;

const EMPTY_LIBRARY: TourLibrary = { hasActivities: false, cutoverChanged: false };
const FULL_LIBRARY: TourLibrary = {
  hasActivities: true,
  sectionId: 'col-du-test',
  routeId: 'harbour-loop',
  cutoverChanged: false,
};

function lookup(bundle: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined,
      bundle
    );
}

describe('the first-run tour', () => {
  const tutorial = getTutorialSlides();

  it('is its own list rather than every release slide in ship order', () => {
    expect(tutorial.map((s) => s.titleKey)).not.toEqual(getAllSlides().map((s) => s.titleKey));
  });

  it('follows the order the athlete meets things, opening on the first load', () => {
    expect(tutorial.map((s) => s.titleKey)).toEqual([
      'whatsNew.tutorial.firstLoadTitle',
      'whatsNew.tutorial.feedTitle',
      'whatsNew.tutorial.activityTitle',
      'whatsNew.v022.mapStylesTitle',
      'whatsNew.v022.fitnessTitle',
      'whatsNew.v040.sectionPageTitle',
      'whatsNew.v040.routesTitle',
      'whatsNew.v030.backupTitle',
    ]);
  });

  it('draws a picture under every slide, so none shows an empty field under its text', () => {
    // Reads the lazy getter's presence without loading the picture's module.
    const bare = tutorial.filter((s) => !Object.prototype.hasOwnProperty.call(s, 'Component'));
    expect(bare.map((s) => s.titleKey)).toEqual([]);
  });

  it('holds no slide that opens the section preview', () => {
    expect(tutorial.map((s) => s.showMeRoute)).not.toContain('/detection-preview');
  });

  it('still leaves the section preview in the 0.4.0 changes', () => {
    expect(getAllSlides().map((s) => s.showMeRoute)).toContain('/detection-preview');
  });
});

describe('Show Me over the library the first run sees', () => {
  const tutorial = getTutorialSlides();

  it('offers no Show Me into a screen with nothing in it', () => {
    const offered = tutorial
      .filter((slide) => resolveShowMeRoute(slide, EMPTY_LIBRARY) !== undefined)
      .map((slide) => slide.showMeRoute);
    expect(offered).toEqual(['/backup-settings']);
  });

  it('offers no Show Me into sections or routes while only activities have landed', () => {
    const library: TourLibrary = { hasActivities: true, cutoverChanged: false };
    const offered = tutorial
      .filter((slide) => resolveShowMeRoute(slide, library) !== undefined)
      .map((slide) => slide.titleKey);
    expect(offered).not.toContain('whatsNew.v040.sectionPageTitle');
    expect(offered).not.toContain('whatsNew.v040.routesTitle');
    expect(offered).toContain('whatsNew.tutorial.feedTitle');
    expect(offered).toContain('whatsNew.v022.fitnessTitle');
  });

  it('offers every Show Me once the library holds data', () => {
    const routes = tutorial.map((slide) => resolveShowMeRoute(slide, FULL_LIBRARY));
    expect(routes).toEqual([
      undefined,
      '/',
      undefined,
      '/',
      '/fitness',
      '/section/col-du-test',
      '/route/harbour-loop',
      '/backup-settings',
    ]);
  });

  it('gates the release slides the same way', () => {
    const offered = getAllSlides()
      .filter((slide) => resolveShowMeRoute(slide, EMPTY_LIBRARY) !== undefined)
      .map((slide) => slide.showMeRoute);
    expect(offered).not.toContain('/insights?tab=sections');
    expect(offered).not.toContain('/insights?tab=routes');
    expect(offered).not.toContain('/fitness');
  });
});

describe('the first-run tour copy', () => {
  const keys = getTutorialSlides()
    .filter((s) => s.titleKey.startsWith('whatsNew.tutorial.'))
    .flatMap((s) => [s.titleKey, s.bodyKey, ...(s.showMeTip ? [s.showMeTip] : [])]);

  it.each(fs.readdirSync(LOCALES_DIR).map((file) => file.replace('.json', '')))(
    'is translated in %s',
    (locale) => {
      const bundle = resolvedLocale(locale);
      const reference = resolvedLocale('en-GB');
      for (const key of keys) {
        const value = lookup(bundle, key);
        expect(`${locale} ${key} ${typeof value}`).toBe(`${locale} ${key} string`);
        if (!ENGLISH.test(locale)) {
          expect(`${locale} ${key} ${value as string}`).not.toBe(
            `${locale} ${key} ${lookup(reference, key) as string}`
          );
        }
      }
    }
  );
});
