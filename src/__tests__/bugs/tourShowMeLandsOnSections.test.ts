/**
 * Scenario: the 0.4.0 tour slide says sections are deterministic and reshape
 * with the athlete's runs, then offers Show Me.
 *
 * Expected behaviour: it lands on the detector settings, where the rule behind
 * that is configured.
 */

import { WHATS_NEW_SLIDES } from '@/features/settings/components/whatsNew/slides';

/** The sub-tabs the insights screen accepts as a route param. */
const INSIGHTS_TABS = ['insights', 'strength', 'routes', 'sections', 'debug'];

function slideRoutes(version: string): (string | undefined)[] {
  return WHATS_NEW_SLIDES[version].map((slide) => slide.showMeRoute);
}

describe("the tour's Show Me targets", () => {
  it('takes the 0.4.0 sections slide to the detector settings', () => {
    expect(slideRoutes('0.4.0')).toEqual(['/detection-settings']);
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
