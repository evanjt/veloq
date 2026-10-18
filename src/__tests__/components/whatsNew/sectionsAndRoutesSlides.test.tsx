/**
 * Scenario: the tour describes sections, the app's central feature, and routes. The section page
 * charts every attempt over time with a trend, the spread of times, the seconds won or lost along
 * the section and the line coloured where they were won or lost; the tour offered only a slide
 * on trimming, no routes slide, and no way into either page.
 *
 * Expected behaviour: the 0.4.0 tour carries a sections slide drawing those four pictures on fixed
 * demo attempts, and a routes slide, each with a Show Me that opens the athlete's most visited
 * section or route, and none while there is no such section or route.
 */
import React from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { render } from '@testing-library/react-native';
import { resolvedLocale } from '../../i18n/resolvedLocale';
import { WHATS_NEW_SLIDES, getAllSlides } from '@/features/settings/components/whatsNew/slides';
import {
  SECTIONS_LIST_ROUTE,
  ROUTES_LIST_ROUTE,
  resolveShowMeRoute,
  type TourLibrary,
} from '@/features/settings/lib/tourShowMe';
import {
  TOUR_DEMO_ATTEMPTS,
  demoHistogram,
  demoLineStretches,
  pearsonR,
} from '@/features/settings/lib/tourSectionDemo';
import { SectionPerformanceSlide } from '@/features/settings/components/whatsNew/SectionPerformanceSlide';
import { RoutesSlide } from '@/features/settings/components/whatsNew/RoutesSlide';
import { layoutViews } from '../../__shared__/layoutViews';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const LOCALES_DIR = path.join(__dirname, '../../../i18n/locales');

const SLIDE_KEYS = [
  'sectionPageTitle',
  'sectionPageBody',
  'sectionPageTrendR',
  'sectionPageLine',
  'routesTitle',
  'routesBody',
] as const;

function slideOf(titleKey: string) {
  const slide = WHATS_NEW_SLIDES['0.4.0'].find((s) => s.titleKey === titleKey);
  if (!slide) throw new Error(`no 0.4.0 slide titled ${titleKey}`);
  return slide;
}

describe('the 0.4.0 tour', () => {
  it('opens with a sections slide and a routes slide, each offering Show Me', () => {
    const titles = WHATS_NEW_SLIDES['0.4.0'].map((s) => s.titleKey);
    expect(titles.slice(0, 2)).toEqual([
      'whatsNew.v040.sectionPageTitle',
      'whatsNew.v040.routesTitle',
    ]);
    expect(slideOf('whatsNew.v040.sectionPageTitle').showMeRoute).toBe(SECTIONS_LIST_ROUTE);
    expect(slideOf('whatsNew.v040.routesTitle').showMeRoute).toBe(ROUTES_LIST_ROUTE);
  });

  it('no longer gives section trimming a slide of its own', () => {
    const titles = getAllSlides().map((s) => s.titleKey);
    expect(titles).not.toContain('whatsNew.v030.sectionTrimTitle');
  });
});

describe('the sections and routes Show Me', () => {
  const sections = slideOf('whatsNew.v040.sectionPageTitle');
  const routes = slideOf('whatsNew.v040.routesTitle');
  const library = (places: { sectionId?: string; routeId?: string }): TourLibrary => ({
    hasActivities: true,
    cutoverChanged: false,
    ...places,
  });

  it('opens the most visited section', () => {
    expect(resolveShowMeRoute(sections, library({ sectionId: 's-busy', routeId: 'r-busy' }))).toBe(
      '/section/s-busy'
    );
  });

  it('opens the route with the most activities', () => {
    expect(resolveShowMeRoute(routes, library({ sectionId: 's-busy', routeId: 'r-busy' }))).toBe(
      '/route/r-busy'
    );
  });

  it('offers no Show Me when the library has none', () => {
    expect(resolveShowMeRoute(sections, library({}))).toBeUndefined();
    expect(resolveShowMeRoute(routes, library({}))).toBeUndefined();
  });

  it('offers no Show Me when only the other kind exists', () => {
    expect(resolveShowMeRoute(sections, library({ routeId: 'r-busy' }))).toBeUndefined();
    expect(resolveShowMeRoute(routes, library({ sectionId: 's-busy' }))).toBeUndefined();
  });

  it('leaves a slide with a fixed route on that route', () => {
    const settings = WHATS_NEW_SLIDES['0.4.0'].find((s) => s.showMeRoute === '/detection-preview');
    expect(settings).toBeDefined();
    expect(resolveShowMeRoute(settings!, library({ sectionId: 's-busy', routeId: 'r-busy' }))).toBe(
      '/detection-preview'
    );
  });
});

describe('the demo attempts the sections slide draws', () => {
  it('reads a perfect rise as 1, a perfect fall as -1, and a flat series as no coefficient', () => {
    expect(pearsonR([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 10);
    expect(pearsonR([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 10);
    expect(pearsonR([1, 2, 3, 4], [5, 5, 5, 5])).toBeNull();
    expect(pearsonR([1], [5])).toBeNull();
  });

  it('gets faster over time, so the trend coefficient is negative', () => {
    const r = pearsonR(
      TOUR_DEMO_ATTEMPTS.map((_, i) => i),
      TOUR_DEMO_ATTEMPTS.map((a) => a.timeSecs)
    );
    expect(r).not.toBeNull();
    expect(r!).toBeLessThan(-0.5);
  });

  it('puts every attempt in exactly one histogram bin', () => {
    const bins = demoHistogram(6);
    expect(bins).toHaveLength(6);
    expect(bins.reduce((sum, n) => sum + n, 0)).toBe(TOUR_DEMO_ATTEMPTS.length);
  });

  it('colours both a won and a lost stretch on the line', () => {
    const kinds = new Set(demoLineStretches().map((s) => s.kind));
    expect(kinds.has('won')).toBe(true);
    expect(kinds.has('lost')).toBe(true);
  });
});

describe('the sections and routes slides', () => {
  it("captions the three chart pictures with the section panel's own view names", async () => {
    const tree = await render(<SectionPerformanceSlide />);
    await layoutViews(tree, 320, 300);
    const { getByText } = tree;
    for (const key of [
      'sections.viewOverTime',
      'sections.viewSpread',
      'sections.viewAheadOrBehind',
    ]) {
      expect(getByText(key)).toBeTruthy();
    }
    for (const key of ['sectionPageLine', 'sectionPageTrendR']) {
      expect(getByText(`whatsNew.v040.${key}`)).toBeTruthy();
    }
  });

  it('renders the routes picture', async () => {
    const { getByTestId } = await render(<RoutesSlide />);
    expect(getByTestId('tour-routes-picture')).toBeTruthy();
  });

  it('has a value for every key in every locale', () => {
    for (const file of fs.readdirSync(LOCALES_DIR)) {
      const bundle = resolvedLocale(file.replace('.json', ''));
      for (const key of SLIDE_KEYS) {
        const value: unknown = bundle.whatsNew.v040[key];
        expect(`${file} ${key} ${typeof value}`).toBe(`${file} ${key} string`);
      }
      expect(bundle.whatsNew.v040.sectionPageTrendR).toContain('{{r}}');
    }
  });
});
