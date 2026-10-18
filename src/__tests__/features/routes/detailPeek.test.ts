/**
 * Scenario: a route or section card's lowest stop shows the name, one date line and three
 * numbers, so the athlete can tell the subject apart with the map nearly uncovered.
 */

import { i18n, initialiseI18n } from '@/i18n';
import {
  detailDateLine,
  detailPeekStats,
  type DetailPeekInput,
} from '@/features/routes/lib/detailPeek';

const t = i18n.t.bind(i18n);

beforeAll(async () => {
  await initialiseI18n('en-AU');
});

const loaded: DetailPeekInput = {
  kind: 'route',
  distanceMeters: 12_400,
  scope: { count: 9, sport: 'Ride', sportsOffered: 1, range: 'all' },
  bestTimeSecs: 1_845,
  firstDate: new Date(2024, 2, 3),
  lastDate: new Date(2026, 9, 2),
};

describe('a route card at Peek', () => {
  it('shows the distance, the visits and the best time, in that order', () => {
    const stats = detailPeekStats(loaded, t);

    expect(stats.map((stat) => stat.text)).toEqual(['12.4 km', '9 activities', 'PR 30:45']);
    expect(stats[0]?.label).toBe('Distance: 12.4 km');
  });

  it('shows only the distance until the attempts are read', () => {
    const stats = detailPeekStats(
      { ...loaded, scope: { ...loaded.scope, count: undefined }, bestTimeSecs: undefined },
      t
    );

    expect(stats.map((stat) => stat.text)).toEqual(['12.4 km']);
  });

  it('joins the first and last attempt dates with middle dots', () => {
    const line = detailDateLine(loaded, t);

    expect(line.split(' · ')).toHaveLength(2);
    expect(line).toMatch(/^First .+ · Last .+$/);
  });

  it('leads the date line with the sport and the range when either narrows the attempts', () => {
    const line = detailDateLine(
      { ...loaded, scope: { count: 3, sport: 'Ride', sportsOffered: 2, range: '3m' } },
      t
    );

    expect(line.split(' · ').slice(0, 2)).toEqual(['Ride', '3 months']);
    expect(line.split(' · ')).toHaveLength(4);
  });

  it('is empty with no attempt read and nothing narrowing them', () => {
    expect(detailDateLine({ ...loaded, firstDate: null, lastDate: null }, t)).toBe('');
  });
});

describe('a section card at Peek', () => {
  it('counts traversals in its own word between the distance and the best time', () => {
    const stats = detailPeekStats({ ...loaded, kind: 'section', distanceMeters: 1_200 }, t);

    expect(stats.map((stat) => stat.text)).toEqual(['1.2 km', '9 traversals', 'PR 30:45']);
  });
});
