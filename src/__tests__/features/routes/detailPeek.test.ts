/**
 * Scenario: a route or section card's lowest stop shows the name, one date line and one line of
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

  it('gives the first and last attempt as one range', () => {
    expect(detailDateLine(loaded, t)).toBe('3 Mar 2024 – 2 Oct 2026');
  });

  it('keeps three figures with no elevation', () => {
    expect(detailPeekStats(loaded, t)).toHaveLength(3);
  });

  it('leads the date line with the sport and the range when either narrows the attempts', () => {
    const line = detailDateLine(
      { ...loaded, scope: { count: 3, sport: 'Ride', sportsOffered: 2, range: '3m' } },
      t
    );

    expect(line).toBe('Ride · 3 months · 3 Mar 2024 – 2 Oct 2026');
  });

  it('names the one date it has when the first is missing', () => {
    expect(detailDateLine({ ...loaded, firstDate: null }, t)).toBe('2 Oct 2026');
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

  const section: DetailPeekInput = {
    kind: 'section',
    distanceMeters: 1_400,
    scope: { count: 26, sport: 'Run', sportsOffered: 2, range: '6m' },
    bestTimeSecs: 409,
    firstDate: new Date(2026, 6, 22),
    lastDate: new Date(2026, 9, 3),
  };

  it("puts a descent's loss second, signed, on the one stats line", () => {
    const stats = detailPeekStats({ ...section, elevation: { metres: 37, direction: 'loss' } }, t);

    expect(stats.map((stat) => stat.text)).toEqual(['1.4 km', '-37 m', '26 traversals', 'PR 6:49']);
    expect(stats[1]?.label).toBe('Elevation: -37 m');
  });

  it("puts a climb's gain second, unsigned", () => {
    const stats = detailPeekStats({ ...section, elevation: { metres: 37, direction: 'gain' } }, t);

    expect(stats.map((stat) => stat.text)).toEqual(['1.4 km', '37 m', '26 traversals', 'PR 6:49']);
  });

  it('reads the sport, the range and the span on one line', () => {
    expect(detailDateLine(section, t)).toBe('Run · 6 months · 22 July – 3 Oct 2026');
  });
});
