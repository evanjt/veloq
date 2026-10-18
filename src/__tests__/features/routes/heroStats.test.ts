/**
 * Scenario: a section card states its vertical on the Peek line and its grades in the summary,
 * and a stat that named a level road's grade or a flat section's climbing read as noise.
 *
 * Expected behaviour: the gain, or the loss signed for a descent; the average grade when it is
 * not level, then the steepest grade of a climb or descent. Each stat carries the words a screen
 * reader says for it, naming what the value is. The scope labels name what narrows a count.
 */

import { i18n, initialiseI18n } from '@/i18n';
import { elevationStat, scopeLabels, sectionGradeStats } from '@/features/routes/lib/heroStats';
import { sectionElevation } from '@/features/routes/lib/sectionElevation';
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

  it('states the gain of a climb', () => {
    const stat = elevationStat(sectionElevation(climb)!, t);

    expect(stat).toEqual({ text: '120 m', label: 'Elevation gain: 120 m' });
  });

  it('gives a descent its loss, signed', () => {
    const descent = sectionElevation({ elevationGainM: 3, elevationLossM: 80, klass: 'descent' });

    expect(elevationStat(descent!, t)).toEqual({ text: '-80 m', label: 'Elevation: -80 m' });
  });

  it('states the climbing in feet for an imperial athlete', () => {
    expect(elevationStat(sectionElevation(climb)!, t, false).text).toBe('394 ft');
  });

  it('states both grades of a climb, each named for a screen reader', () => {
    const stats = sectionGradeStats(climb, t);

    expect(texts(stats)).toEqual(['6.7%', 'Steepest 11.2%']);
    expect(stats.map((stat) => stat.label)).toEqual(['Avg grade: 6.7%', 'Steepest 11.2%']);
  });

  it('leaves a level average grade off', () => {
    expect(texts(sectionGradeStats({ ...climb, avgGradePercent: 0.4 }, t))).toEqual([
      'Steepest 11.2%',
    ]);
  });

  it('states no grade for flat ground', () => {
    expect(
      sectionGradeStats(
        { elevationGainM: 0, elevationLossM: 0, avgGradePercent: 3, klass: 'flat' },
        t
      )
    ).toEqual([]);
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
