/**
 * Scenario: the eFTP chart plots the engine's daily series and its badge
 * states the step the engine measured over the window the caption names.
 *
 * Expected behaviour: the view maps the engine's records onto local days and
 * carries the engine's step, and does not derive a second one from the points.
 */

import { ftpTrendView } from '@/features/fitness/lib/ftpTrendView';

/** The engine's day: midnight UTC. */
const midnightUtc = (day: string) => Date.parse(`${day}T00:00:00Z`) / 1000;

describe('ftpTrendView', () => {
  it('dates each point by the day the engine stored it for and keeps the engine order', () => {
    const view = ftpTrendView({
      latestFtp: 250,
      previousFtp: 240,
      deltaWatts: 10,
      sampleCount: 3,
      changes: [],
      history: [
        { date: midnightUtc('2026-06-01'), value: 240 },
        { date: midnightUtc('2026-06-02'), value: 245 },
        { date: midnightUtc('2026-06-03'), value: 250 },
      ],
    });

    expect(view.series.map((p) => p.date)).toEqual(['2026-06-01', '2026-06-02', '2026-06-03']);
    expect(view.series.map((p) => p.eftp)).toEqual([240, 245, 250]);
  });

  it('states the engine step and its percentage of the earlier value', () => {
    const view = ftpTrendView({
      latestFtp: 250,
      previousFtp: 200,
      deltaWatts: 50,
      sampleCount: 91,
      changes: [],
      history: [],
    });

    expect(view.latest).toBe(250);
    expect(view.change).toBe(50);
    expect(view.changePercent).toBeCloseTo(25, 5);
  });

  it('reports a fall with its sign', () => {
    const view = ftpTrendView({
      latestFtp: 180,
      previousFtp: 200,
      deltaWatts: -20,
      sampleCount: 91,
      changes: [],
      history: [],
    });

    expect(view.change).toBe(-20);
    expect(view.changePercent).toBeCloseTo(-10, 5);
  });

  it('has no step when the engine had nothing to compare against', () => {
    const view = ftpTrendView({
      latestFtp: 250,
      sampleCount: 1,
      changes: [],
      history: [{ date: midnightUtc('2026-06-03'), value: 250 }],
    });

    expect(view.latest).toBe(250);
    expect(view.change).toBe(0);
    expect(view.changePercent).toBe(0);
  });

  it('is empty without a stored estimate', () => {
    const view = ftpTrendView({ sampleCount: 0, history: [], changes: [] });

    expect(view.series).toEqual([]);
    expect(view.latest).toBe(0);
  });
});
