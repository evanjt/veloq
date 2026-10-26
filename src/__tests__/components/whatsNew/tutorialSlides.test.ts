/**
 * Scenario: an athlete signs in for the first time. The tour opens while the first load is still
 * running, over a library with no activities, sections or routes yet.
 *
 * Expected behaviour: the tour is its own list, opening on the two setup slides the athlete acts
 * on, the map style and the notifications, and carrying no first-load, feed or activity page and
 * no release-only slide such as the section preview. A slide whose Show Me would land on a screen with nothing in it offers no
 * Show Me until that screen holds data.
 */
import * as fs from 'fs';
import React from 'react';
import { render } from '@testing-library/react-native';
import * as path from 'path';
import { resolvedLocale } from '../../i18n/resolvedLocale';
import {
  WHATS_NEW_SLIDES,
  getAllSlides,
  getTutorialSlides,
  getTutorialSlidesFor,
} from '@/features/settings/components/whatsNew/slides';
import { resolveShowMeRoute, type TourLibrary } from '@/features/settings/lib/tourShowMe';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const LOCALES_DIR = path.join(__dirname, '../../../i18n/locales');
const ENGLISH = /^en(-|$)/;

const EMPTY_LIBRARY: TourLibrary = {
  hasActivities: false,
  cutoverChanged: false,
  usesGarmin: false,
};
const FULL_LIBRARY: TourLibrary = {
  hasActivities: true,
  sectionId: 'col-du-test',
  routeId: 'harbour-loop',
  cutoverChanged: false,
  usesGarmin: false,
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

  it('leaves out a held setup slide and keeps every other slide in order', () => {
    const held = getTutorialSlidesFor(null, ['notifications']);
    expect(held.map((slide) => slide.setup).filter(Boolean)).toEqual(['garmin', 'backup']);
    expect(held).toEqual(tutorial.filter((slide) => slide.setup !== 'notifications'));
    expect(getTutorialSlidesFor(['notifications', 'backup'], ['notifications'])).toEqual(
      tutorial.filter((slide) => slide.setup === 'backup')
    );
  });

  it('is its own list rather than every release slide in ship order', () => {
    expect(tutorial.map((s) => s.titleKey)).not.toEqual(getAllSlides().map((s) => s.titleKey));
  });

  it('opens on the map styles and the notifications setup, and ends on backup', () => {
    expect(tutorial.map((s) => s.titleKey)).toEqual([
      'whatsNew.v022.mapStylesTitle',
      'whatsNew.tutorial.notificationsTitle',
      'whatsNew.tutorial.garminTitle',
      'whatsNew.v040.recordingTitle',
      'whatsNew.v040.mapsWidgetsTitle',
      'whatsNew.v040.rebuiltTitle',
      'whatsNew.v040.sectionPageTitle',
      'whatsNew.v040.routesTitle',
      'whatsNew.v030.backupTitle',
    ]);
    expect(tutorial[1].setup).toBe('notifications');
  });

  it('holds no page about the first load, the feed or an activity', () => {
    const titles = tutorial.map((s) => s.titleKey);
    expect(titles).not.toContain('whatsNew.tutorial.firstLoadTitle');
    expect(titles).not.toContain('whatsNew.tutorial.feedTitle');
    expect(titles).not.toContain('whatsNew.tutorial.activityTitle');
  });

  it('draws a picture under every slide, so none shows an empty field under its text', () => {
    // Reads the lazy getter's presence without loading the picture's module.
    const bare = tutorial.filter((s) => !Object.prototype.hasOwnProperty.call(s, 'Component'));
    expect(bare.map((s) => s.titleKey)).toEqual([]);
  });

  it('holds no slide that opens the section preview', () => {
    expect(tutorial.map((s) => s.showMeRoute)).not.toContain('/detection-preview');
  });
});

describe("What's New 0.4.0", () => {
  const release = WHATS_NEW_SLIDES['0.4.0'];
  const LOOK = 'whatsNew.v040.lookTitle';

  it('sells the release in six slides, opening on the notifications to turn on', () => {
    expect(release.map((s) => s.titleKey)).toEqual([
      'whatsNew.tutorial.notificationsTitle',
      'whatsNew.tutorial.garminTitle',
      'whatsNew.v040.recordingTitle',
      LOOK,
      'whatsNew.v040.mapsWidgetsTitle',
      'whatsNew.v040.rebuiltTitle',
    ]);
    expect(release[0].setup).toBe('notifications');
  });

  it('draws a picture under every slide', () => {
    const bare = release.filter((s) => !Object.prototype.hasOwnProperty.call(s, 'Component'));
    expect(bare.map((s) => s.titleKey)).toEqual([]);
  });

  it('shares every slide but the look with the tour', () => {
    const inTour = new Set(getTutorialSlides().map((s) => s.titleKey));
    const missing = release.filter((s) => s.titleKey !== LOOK && !inTour.has(s.titleKey));
    expect(missing.map((s) => s.titleKey)).toEqual([]);
    expect(inTour.has(LOOK)).toBe(false);
  });

  it('holds no slide that opens the section preview', () => {
    expect(release.map((s) => s.showMeRoute)).not.toContain('/detection-preview');
  });

  it('renders a picture for each new slide', async () => {
    const ids: Record<string, string> = {
      'whatsNew.v040.recordingTitle': 'tour-recording-picture',
      [LOOK]: 'tour-look-picture',
      'whatsNew.v040.mapsWidgetsTitle': 'tour-maps-widgets-picture',
      'whatsNew.v040.rebuiltTitle': 'tour-sections-rebuilt-picture',
    };
    for (const slide of release.filter((s) => ids[s.titleKey])) {
      const { Component } = slide;
      const { getByTestId, unmount } = await render(React.createElement(Component));
      expect(getByTestId(ids[slide.titleKey])).toBeTruthy();
      unmount();
    }
  });
});

describe('Show Me over the library the first run sees', () => {
  const tutorial = getTutorialSlides();

  it('offers no Show Me into a screen with nothing in it', () => {
    const offered = tutorial
      .filter((slide) => resolveShowMeRoute(slide, EMPTY_LIBRARY) !== undefined)
      .map((slide) => slide.showMeRoute);
    expect(offered).toEqual(['/record', '/map-settings', '/backup-settings']);
  });

  it('offers no Show Me into sections or routes while only activities have landed', () => {
    const library: TourLibrary = { hasActivities: true, cutoverChanged: false, usesGarmin: false };
    const offered = tutorial
      .filter((slide) => resolveShowMeRoute(slide, library) !== undefined)
      .map((slide) => slide.titleKey);
    expect(offered).not.toContain('whatsNew.v040.sectionPageTitle');
    expect(offered).not.toContain('whatsNew.v040.routesTitle');
    expect(offered).toContain('whatsNew.v022.mapStylesTitle');
  });

  it('offers every Show Me once the library holds data', () => {
    const routes = tutorial.map((slide) => resolveShowMeRoute(slide, FULL_LIBRARY));
    expect(routes).toEqual([
      '/',
      undefined,
      undefined,
      '/record',
      '/map-settings',
      undefined,
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
  const keys = [...getTutorialSlides(), ...WHATS_NEW_SLIDES['0.4.0']]
    .filter(
      (s) => s.titleKey.startsWith('whatsNew.tutorial.') || s.titleKey.startsWith('whatsNew.v040.')
    )
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
