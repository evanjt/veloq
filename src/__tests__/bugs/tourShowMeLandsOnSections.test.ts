/**
 * Scenario: the 0.4.0 sections slide is shared by the tour and What's New, and the tour can open
 * over a library with no sections yet.
 *
 * Expected behaviour: it offers no Show Me into the section preview, which the tour keeps out.
 */

import { readdirSync } from 'fs';
import { join } from 'path';
import { WHATS_NEW_SLIDES } from '@/features/settings/components/whatsNew/slides';

const LOCALES_DIR = join(__dirname, '../../i18n/locales');

function lookup(tree: unknown, key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], tree);
}

/** The sub-tabs the insights screen accepts as a route param. */
const INSIGHTS_TABS = ['insights', 'strength', 'routes', 'sections', 'debug'];

function slideRoutes(version: string): (string | undefined)[] {
  return WHATS_NEW_SLIDES[version].map((slide) => slide.showMeRoute);
}

describe("the tour's Show Me targets", () => {
  it('offers the 0.4.0 sections slide no Show Me', () => {
    const slide = WHATS_NEW_SLIDES['0.4.0'].find(
      (s) => s.titleKey === 'whatsNew.v040.rebuiltTitle'
    );
    expect(slide).toBeDefined();
    expect(slide?.showMeRoute).toBeUndefined();
    expect(slideRoutes('0.4.0')).not.toContain('/detection-preview');
  });

  it('translates every tip wherever its slide is translated', () => {
    for (const file of readdirSync(LOCALES_DIR).filter((name) => name.endsWith('.json'))) {
      const strings = require(join(LOCALES_DIR, file));
      for (const slides of Object.values(WHATS_NEW_SLIDES)) {
        for (const slide of slides) {
          if (!slide.showMeTip || lookup(strings, slide.titleKey) === undefined) continue;
          expect([file, typeof lookup(strings, slide.showMeTip)]).toEqual([file, 'string']);
        }
      }
    }
  });

  it('leaves the 0.3.0 insights slide on the insights sub-tab', () => {
    expect(slideRoutes('0.3.0')).toContain('/insights');
  });

  it('names a sub-tab the insights screen accepts wherever one is given', () => {
    for (const slides of Object.values(WHATS_NEW_SLIDES)) {
      for (const slide of slides) {
        const [path, query] = (slide.showMeRoute ?? '').split('?');
        if (path !== '/insights' || !query) continue;
        const tab = new URLSearchParams(query).get('tab');
        expect(INSIGHTS_TABS).toContain(tab);
      }
    }
  });

  it('gives every slide that offers Show Me a route to go to', () => {
    for (const slides of Object.values(WHATS_NEW_SLIDES)) {
      for (const slide of slides) {
        if (slide.showMeRoute === undefined) continue;
        expect(slide.showMeRoute.startsWith('/')).toBe(true);
      }
    }
  });
});
