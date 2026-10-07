import { paceCurveSamples } from '@/features/stats/lib/paceCurvePoints';

describe('paceCurveSamples', () => {
  it('keeps a run curve slower than 10:00/km at every distance', () => {
    const speed = 1000 / 660;
    const samples = paceCurveSamples({
      distances: [400, 1000, 5000, 21097],
      times: [264, 660, 3300, 13924],
      pace: [speed, speed, speed, speed],
    });
    expect(samples.map((s) => s.distance)).toEqual([400, 1000, 5000, 21097]);
  });

  it('keeps sub-100 m run points and sub-50 s/100m swim sprints', () => {
    const samples = paceCurveSamples({ distances: [50, 25], times: [20, 10], pace: [2.5, 2.5] });
    expect(samples).toHaveLength(2);
  });

  it('keeps a swim point slower than 4:00/100m', () => {
    const samples = paceCurveSamples({ distances: [1500], times: [3750], pace: [0.4] });
    expect(samples).toHaveLength(1);
  });

  it('drops only non-positive or missing values', () => {
    const samples = paceCurveSamples({
      distances: [100, 0, 300, 400],
      times: [30, 30, 0, 100],
      pace: [3, 3, 3, 0],
    });
    expect(samples.map((s) => s.distance)).toEqual([100]);
  });

  it('returns nothing for a missing or empty curve', () => {
    expect(paceCurveSamples(null)).toEqual([]);
    expect(paceCurveSamples({ distances: [], times: [], pace: [] })).toEqual([]);
  });
});
