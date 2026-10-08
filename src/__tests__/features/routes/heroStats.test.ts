/**
 * Scenario: the section page and the route page each draw a stats row over
 * their map, and the route's counted every attempt across sports and dates
 * whatever chip or range was on screen, and showed no climbing.
 *
 * Expected behaviour: one list serves both heroes: the distance, the attempts
 * the chart plots labelled with the sport and range when either narrows them,
 * then the climbing. Grades stay with a section.
 */

import { i18n, initialiseI18n } from '@/i18n';
import { heroStats } from '@/features/routes/lib/heroStats';

const t = i18n.t.bind(i18n);

beforeAll(async () => {
  await initialiseI18n('en-AU');
});

describe('a route hero', () => {
  const route = { kind: 'route', distanceMeters: 12_400, elevationGainMeters: 236 } as const;

  it('counts the attempts the chart plots in the sport and range on screen', () => {
    const stats = heroStats(route, { count: 4, sport: 'Ride', sportsOffered: 2, range: '3m' }, t);

    expect(stats).toEqual(['12.4 km', '4 activities · Ride · 3 months', '236 m']);
  });

  it('gives the bare count when one sport is offered over every date', () => {
    const stats = heroStats(route, { count: 7, sport: 'Ride', sportsOffered: 1, range: 'all' }, t);

    expect(stats).toEqual(['12.4 km', '7 activities', '236 m']);
  });

  it('takes the singular at one attempt', () => {
    const stats = heroStats(route, { count: 1, sport: 'Run', sportsOffered: 1, range: '1y' }, t);

    expect(stats[1]).toBe('1 activity · 1 year');
  });

  it('leaves the count off until the attempts are read', () => {
    const stats = heroStats(
      route,
      { count: undefined, sport: undefined, sportsOffered: 0, range: 'all' },
      t
    );

    expect(stats).toEqual(['12.4 km', '236 m']);
  });

  it('leaves the climbing off a route too flat to have any', () => {
    const flat = { ...route, elevationGainMeters: 4 };

    expect(heroStats(flat, { count: 2, sport: 'Run', sportsOffered: 1, range: 'all' }, t)).toEqual([
      '12.4 km',
      '2 activities',
    ]);
  });

  it('states the climbing in feet for an imperial athlete', () => {
    const stats = heroStats(
      route,
      { count: 2, sport: 'Run', sportsOffered: 1, range: 'all' },
      t,
      false
    );

    expect(stats[2]).toBe('774 ft');
  });
});

describe('a section hero', () => {
  const climb = {
    kind: 'section',
    section: {
      distanceMeters: 1_800,
      elevationGainM: 120,
      elevationLossM: 2,
      avgGradePercent: 6.7,
      maxGradePercent: 11.2,
      klass: 'climb',
    },
  } as const;

  it('counts traversals in its own word, then the climbing and both grades', () => {
    const stats = heroStats(climb, { count: 9, sport: 'Run', sportsOffered: 2, range: '6m' }, t);

    expect(stats).toEqual([
      '1.8 km',
      '9 traversals · Run · 6 months',
      '120 m',
      '6.7%',
      'Steepest 11.2%',
    ]);
  });

  it('gives a descent its loss', () => {
    const descent = {
      kind: 'section',
      section: { distanceMeters: 900, elevationGainM: 3, elevationLossM: 80, klass: 'descent' },
    } as const;

    expect(
      heroStats(descent, { count: 3, sport: 'Ride', sportsOffered: 1, range: 'all' }, t)
    ).toEqual(['900 m', '3 traversals', '-80 m']);
  });
});
