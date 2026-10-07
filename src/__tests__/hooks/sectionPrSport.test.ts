/**
 * Scenario: a section ridden forty times and run three times. A run record in
 * the last week produced a card whose confidence stood on 43 traversals, whose
 * icon was a bicycle, and which named no sport anywhere.
 *
 * Expected behaviour: the card carries the record's sport and that sport's
 * traversals, and labels itself with the record's sport rather than the
 * section's.
 */

import { generateSectionPRInsights } from '@/features/insights/generators/sectionPR';
import { cardSportType } from '@/features/insights/lib/cardSport';
import type { SectionPR } from '@/features/insights/types';

const NOW = 1_700_000_000_000;
const t = (key: string) => key;

const RUN_PR: SectionPR = {
  sectionId: 'auto1',
  sectionName: 'Shared Climb',
  bestTime: 300,
  daysAgo: 2,
  sportType: 'Run',
  traversalCount: 3,
};

describe('a section PR card', () => {
  it('carries the sport the record was set in', () => {
    const [insight] = generateSectionPRInsights([RUN_PR], NOW, t);
    expect(insight.supportingData?.sections?.[0].sportType).toBe('Run');
  });

  it("carries that sport's traversals, not the section's", () => {
    const [insight] = generateSectionPRInsights([RUN_PR], NOW, t);
    expect(insight.supportingData?.sections?.[0].traversalCount).toBe(3);
  });

  it('stands its confidence on the three runs', () => {
    const [runInsight] = generateSectionPRInsights([RUN_PR], NOW, t);
    const [rideInsight] = generateSectionPRInsights(
      [{ ...RUN_PR, sportType: 'Ride', traversalCount: 43 }],
      NOW,
      t
    );
    expect(runInsight.confidence).toBeLessThan(rideInsight.confidence as number);
  });
});

describe('the sport a card labels itself with', () => {
  it("is the record's, where there is one", () => {
    expect(cardSportType('Run', ['Ride'])).toBe('Run');
  });

  it("falls back to the section's only sport", () => {
    expect(cardSportType(undefined, ['Ride'])).toBe('Ride');
  });

  it('is nothing for ground several sports have taken, whichever is busier', () => {
    expect(cardSportType(undefined, ['Ride', 'Run'])).toBeUndefined();
  });

  it('is nothing when neither says', () => {
    expect(cardSportType(undefined, undefined)).toBeUndefined();
    expect(cardSportType(undefined, [])).toBeUndefined();
  });
});
