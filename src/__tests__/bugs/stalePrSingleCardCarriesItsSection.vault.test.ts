/**
 * Scenario: the engine returns one stale opportunity, a run section. The sheet
 * draws its map, its sport and its section row from `supportingData.sections`,
 * which only the group card filled, so one opportunity opened on no map, no
 * row and a sentence pointing at a section below that was not there.
 *
 * Expected behaviour: one opportunity carries the same section entry a group
 * carries for each of its members.
 */

import type { StalePrOpportunity } from 'veloqrs';

import { generateStalePRInsights } from '@/features/insights/generators/stalePr';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

const t = (key: string) => key;

function opportunity(sectionId: string, sectionName: string): StalePrOpportunity {
  return {
    sectionId,
    sectionName,
    bestTimeSecs: 1260,
    daysSinceLast: 45,
    traversalCount: 8,
    fitnessMetric: 'pace',
    currentValue: 4.1,
    previousValue: 3.9,
    gainPercent: 5,
    unit: '/km',
    sportType: 'Run',
  } as unknown as StalePrOpportunity;
}

describe('the stale PR card section', () => {
  it('is carried by a card with one opportunity', () => {
    const [insight] = generateStalePRInsights([opportunity('river', 'River Loop')], t, 0);

    expect(insight.supportingData?.sections).toEqual([
      { sectionId: 'river', sectionName: 'River Loop', bestTime: 1260, sportType: 'Run' },
    ]);
  });

  it('is the same entry the group card carries for that section', () => {
    const [single] = generateStalePRInsights([opportunity('river', 'River Loop')], t, 0);
    const [group] = generateStalePRInsights(
      [opportunity('river', 'River Loop'), opportunity('hill', 'Hill')],
      t,
      0
    );

    expect(group.supportingData?.sections?.[0]).toEqual(single.supportingData?.sections?.[0]);
  });
});
