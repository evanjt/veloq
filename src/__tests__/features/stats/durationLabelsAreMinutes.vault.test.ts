/**
 * Scenario: the power curve axis, the cycling Season Bests rows and the
 * climbing windows wrote five minutes as "5m", the metre symbol, in the same
 * list as a "400m" swim distance, and in English under every locale.
 *
 * Expected behaviour: a duration label is written by the duration formatter,
 * so minutes read "min" and the locale's units are used.
 */

import { powerCurveAxisLabels } from '@/features/stats/components/PowerCurveChart';
import { bestEffortsOf, climbBestsOf } from '@/features/stats/hooks/useSeasonBests';
import { i18n, initialiseI18n } from '@/i18n';
import { BestEffortKind, type BestEffortsData } from 'veloqrs';

const read = {
  sports: [
    {
      sport: 'Ride',
      efforts: [
        { label: '5s', kind: BestEffortKind.Duration, checkpoint: 5, value: 900 },
        { label: '5m', kind: BestEffortKind.Duration, checkpoint: 300, value: 320 },
        { label: '1h', kind: BestEffortKind.Duration, checkpoint: 3600, value: 250 },
      ],
    },
    {
      sport: 'Swim',
      efforts: [{ label: '400m', kind: BestEffortKind.Distance, checkpoint: 400, value: 1.2 }],
    },
  ],
  climbing: [
    {
      sport: 'Ride',
      owed: 0,
      sourceExcluded: 0,
      bests: [{ label: '10m', windowS: 600, vam: 900, wattsPerKg: 2.45 }],
    },
  ],
} as unknown as BestEffortsData;

const METRE_MINUTE = /\dm$/;

describe('duration labels', () => {
  beforeEach(async () => {
    await initialiseI18n('en-AU');
  });

  it('label the power curve axis in minutes, not metres', () => {
    const labels = powerCurveAxisLabels().map((l) => l.label);
    expect(labels).toEqual(['5 s', '1 min', '5 min', '20 min', '1 h']);
  });

  it('label the cycling bests and climbing windows in minutes and keep swim distances', () => {
    expect(bestEffortsOf(read, 'Cycling', i18n.t).map((e) => e.label)).toEqual([
      '5 s',
      '5 min',
      '1 h',
    ]);
    expect(climbBestsOf(read, 'Cycling').map((b) => b.label)).toEqual(['10 min']);
    expect(bestEffortsOf(read, 'Swimming', i18n.t).map((e) => e.label)).toEqual(['400 m']);
    for (const e of bestEffortsOf(read, 'Cycling', i18n.t))
      expect(e.label).not.toMatch(METRE_MINUTE);
  });

  it('use the locale units under ja', async () => {
    await initialiseI18n('ja');
    expect(powerCurveAxisLabels().map((l) => l.label)).toContain('5分');
    expect(bestEffortsOf(read, 'Cycling', i18n.t).map((e) => e.label)).toContain('1時間');
  });
});
