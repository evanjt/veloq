/**
 * Scenario: a runner's critical speed moved from 3.40 to 3.57 metres a second.
 * The card face prints 4:54/km and 4:40/km, and the formula beside it printed
 * '(3.57 - 3.40) / 3.40' with no unit.
 *
 * Expected behaviour: each speed in the formula carries its unit, m/s for a
 * pace and watts for a power.
 */

import type { StalePrOpportunity } from 'veloqrs';

import { initialiseI18n, i18n } from '@/i18n';
import type { TFunc } from '@/features/insights/types';
import { generateStalePRInsights } from '@/features/insights/generators/stalePr';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

const t = i18n.t.bind(i18n) as unknown as TFunc;

function opportunity(over: Partial<Record<string, unknown>>): StalePrOpportunity {
  return {
    sectionId: 'a',
    sectionName: 'Section a',
    bestTimeSecs: 372,
    daysSinceLast: 40,
    traversalCount: 6,
    gainPercent: 5,
    sportType: 'Run',
    fitnessMetric: 'pace',
    currentValue: 3.57,
    previousValue: 3.4,
    unit: '/km',
    ...over,
  } as unknown as StalePrOpportunity;
}

describe('the stale PR formula names its units', () => {
  beforeAll(async () => {
    await initialiseI18n('en-AU');
  });

  it('labels each pace speed in metres a second', () => {
    const [insight] = generateStalePRInsights([opportunity({})], t, 0);
    expect(insight.supportingData?.formula).toContain('(3.57 m/s - 3.40 m/s) / 3.40 m/s');
  });

  it('labels each swim speed in metres a second', () => {
    const [insight] = generateStalePRInsights(
      [opportunity({ unit: '/100m', sportType: 'Swim' })],
      t,
      0
    );
    expect(insight.supportingData?.formula).toContain('(3.57 m/s - 3.40 m/s) / 3.40 m/s');
  });

  it('labels each power in watts', () => {
    const [insight] = generateStalePRInsights(
      [
        opportunity({
          fitnessMetric: 'power',
          unit: 'W',
          sportType: 'Ride',
          currentValue: 252,
          previousValue: 238,
        }),
      ],
      t,
      0
    );
    expect(insight.supportingData?.formula).toContain('(252 W - 238 W) / 238 W');
  });

  it('labels every section line of a group formula', () => {
    const [group] = generateStalePRInsights(
      [opportunity({}), opportunity({ sectionId: 'b', sectionName: 'Section b' })],
      t,
      0
    );
    const lines = (group.supportingData?.formula ?? '').split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).toContain('(3.57 m/s - 3.40 m/s) / 3.40 m/s');
  });
});
