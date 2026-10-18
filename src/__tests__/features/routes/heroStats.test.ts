/**
 * Scenario: a section card shows its climbing and grades under the Peek, and a stats row that
 * named a level road's grade or a flat section's climbing read as noise.
 *
 * Expected behaviour: the gain, or the loss for a descent, then the average grade when it is not
 * level, then the steepest grade of a climb or descent. Each stat carries the words a screen
 * reader says for it, naming what the value is. The scope labels name what narrows a count.
 */

import { i18n, initialiseI18n } from '@/i18n';
import { scopeLabels, sectionClimbStats } from '@/features/routes/lib/heroStats';
import type { HeroStat } from '@/shared/ui/DetailHero';

const t = i18n.t.bind(i18n);
const texts = (stats: HeroStat[]) => stats.map((stat) => stat.text);

beforeAll(async () => {
  await initialiseI18n('en-AU');
});

describe("a section's climbing", () => {
  const climb = {
    elevationGainM: 120,
    elevationLossM: 2,
    avgGradePercent: 6.7,
    maxGradePercent: 11.2,
    klass: 'climb',
  } as const;

  it('states the climbing and both grades of a climb', () => {
    expect(texts(sectionClimbStats(climb, t))).toEqual(['120 m', '6.7%', 'Steepest 11.2%']);
  });

  it('gives a descent its loss', () => {
    const stats = sectionClimbStats({ elevationGainM: 3, elevationLossM: 80, klass: 'descent' }, t);

    expect(texts(stats)).toEqual(['-80 m']);
    expect(stats[0]?.label).toBe('Elevation: -80 m');
  });

  it('leaves a level average grade off', () => {
    expect(texts(sectionClimbStats({ ...climb, avgGradePercent: 0.4 }, t))).toEqual([
      '120 m',
      'Steepest 11.2%',
    ]);
  });

  it('states nothing for flat ground', () => {
    expect(sectionClimbStats({ elevationGainM: 0, elevationLossM: 0, klass: 'flat' }, t)).toEqual(
      []
    );
  });

  it('states the climbing in feet for an imperial athlete', () => {
    expect(texts(sectionClimbStats(climb, t, false))[0]).toBe('394 ft');
  });

  it('names each value for a screen reader', () => {
    expect(sectionClimbStats(climb, t).map((stat) => stat.label)).toEqual([
      'Elevation gain: 120 m',
      'Avg grade: 6.7%',
      'Steepest 11.2%',
    ]);
  });
});

describe('a scope label', () => {
  it('names the sport and the range when both narrow the list', () => {
    expect(scopeLabels({ sport: 'Ride', sportsOffered: 2, range: '1m' }, t)).toEqual([
      'Ride',
      t('period.long.1m'),
    ]);
  });

  it('names the range alone when one sport is offered', () => {
    expect(scopeLabels({ sport: 'Run', sportsOffered: 1, range: '1y' }, t)).toEqual(['1 year']);
  });

  it('names the sport alone over every date', () => {
    expect(scopeLabels({ sport: 'Ride', sportsOffered: 3, range: 'all' }, t)).toEqual(['Ride']);
  });

  it('is empty when nothing narrows the list', () => {
    expect(scopeLabels({ sport: 'Ride', sportsOffered: 1, range: 'all' }, t)).toEqual([]);
    expect(scopeLabels({ sport: undefined, sportsOffered: 0, range: 'all' }, t)).toEqual([]);
  });
});
