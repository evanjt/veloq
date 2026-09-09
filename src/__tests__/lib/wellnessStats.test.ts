/**
 * Expected behaviour: the arrow beside each number compares against a day, not
 * against a row, and says nothing when no row stands close enough to that day.
 */
import { computeWellnessStats } from '@/features/wellness/lib/wellnessStats';
import type { WellnessData } from '@/types';

function day(id: string, rest: Partial<WellnessData> = {}): WellnessData {
  return { id, ...rest } as WellnessData;
}

describe('the summary card arrows', () => {
  it('says nothing about weight when the last weigh-in is older than a fortnight', () => {
    const stats = computeWellnessStats([
      day('2026-09-05', { weight: 71 }),
      day('2026-08-10', { weight: 74 }),
    ]);

    expect(stats.weight).toBe(71);
    expect(stats.weightTrend).toBe('');
  });

  it('compares a weekly weigh-in against the previous one', () => {
    const stats = computeWellnessStats([
      day('2026-09-05', { weight: 71 }),
      day('2026-08-29', { weight: 72.4 }),
    ]);

    expect(stats.weightTrend).toBe('↓');
  });

  it('says nothing about fitness across a gap wider than the day it stands for', () => {
    const stats = computeWellnessStats([
      day('2026-09-05', { ctl: 60, atl: 40 }),
      day('2026-09-01', { ctl: 50, atl: 30 }),
    ]);

    expect(stats.fitness).toBe(60);
    expect(stats.fitnessTrend).toBe('');
    expect(stats.formTrend).toBe('');
  });

  it('reads a one-day gap as the day before', () => {
    const stats = computeWellnessStats([
      day('2026-09-05', { ctl: 60, atl: 40, hrv: 70, restingHR: 48 }),
      day('2026-09-03', { ctl: 50, atl: 38, hrv: 60, restingHR: 52 }),
    ]);

    expect(stats.fitnessTrend).toBe('↑');
    expect(stats.formTrend).toBe('↑');
    expect(stats.hrvTrend).toBe('↑');
    expect(stats.rhrTrend).toBe('↓');
  });

  it('holds each deadband, and moves one step past it', () => {
    const base = { ctl: 60, atl: 40, hrv: 70, restingHR: 48, weight: 71 };
    const inside = computeWellnessStats([
      day('2026-09-05', base),
      day('2026-09-04', { ctl: 60.4, atl: 40, hrv: 71.9, restingHR: 48.9 }),
      day('2026-08-29', { weight: 71.29 }),
    ]);

    expect(inside.fitnessTrend).toBe('');
    expect(inside.formTrend).toBe('');
    expect(inside.hrvTrend).toBe('');
    expect(inside.rhrTrend).toBe('');
    expect(inside.weightTrend).toBe('');

    const outside = computeWellnessStats([
      day('2026-09-05', base),
      day('2026-09-04', { ctl: 58, atl: 40, hrv: 72, restingHR: 49 }),
      day('2026-08-29', { weight: 71.5 }),
    ]);

    expect(outside.fitnessTrend).toBe('↑');
    expect(outside.formTrend).toBe('↑');
    expect(outside.hrvTrend).toBe('↓');
    expect(outside.rhrTrend).toBe('↓');
    expect(outside.weightTrend).toBe('↓');
  });

  it('gives every number and no arrow for a single day', () => {
    const stats = computeWellnessStats([
      day('2026-09-05', { ctl: 60, atl: 40, hrv: 70, restingHR: 48, weight: 71 }),
    ]);

    expect(stats).toEqual({
      fitness: 60,
      fitnessTrend: '',
      form: 20,
      formTrend: '',
      hrv: 70,
      hrvTrend: '',
      rhr: 48,
      rhrTrend: '',
      weight: 71,
      weightTrend: '',
    });
  });

  it('survives an empty history', () => {
    expect(computeWellnessStats([]).fitness).toBe(0);
    expect(computeWellnessStats(undefined).weight).toBeNull();
  });

  it('takes each metric from its own nearest row', () => {
    const stats = computeWellnessStats([
      day('2026-09-05', { ctl: 60, atl: 40, hrv: 70, weight: 71 }),
      day('2026-09-04', { ctl: 58, atl: 40 }),
      day('2026-08-28', { weight: 73 }),
    ]);

    expect(stats.fitnessTrend).toBe('↑');
    expect(stats.hrvTrend).toBe('');
    expect(stats.weightTrend).toBe('↓');
  });
});
