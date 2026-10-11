import {
  BEST_EFFORTS_DEFAULT_PERIOD,
  BEST_EFFORTS_PERIODS,
  bestEffortsDays,
  bestEffortsHref,
  bestEffortsPeriodFromParam,
} from '@/features/stats/lib/bestEffortsPeriod';
import { DEFAULT_PERIOD, PERIOD_LABEL_KEYS } from '@/shared/app/period';

describe('best efforts period', () => {
  it('opens on the shared default period', () => {
    expect(BEST_EFFORTS_DEFAULT_PERIOD).toBe(DEFAULT_PERIOD);
  });

  it('offers every span then all, labelled from the shared vocabulary', () => {
    expect(BEST_EFFORTS_PERIODS.map((o) => o.id)).toEqual(['7d', '1m', '3m', '6m', '1y', 'all']);
    for (const option of BEST_EFFORTS_PERIODS) {
      expect(option.labelKey).toBe(PERIOD_LABEL_KEYS.short[option.id]);
    }
  });

  it('maps each option to its window, with all as the whole-history key', () => {
    expect(BEST_EFFORTS_PERIODS.map((o) => bestEffortsDays(o.id))).toEqual([
      7, 30, 90, 180, 365, 0,
    ]);
  });

  it('opens on the period a link names', () => {
    expect(bestEffortsPeriodFromParam('1y')).toBe('1y');
    expect(bestEffortsPeriodFromParam('all')).toBe('all');
    expect(bestEffortsPeriodFromParam(['3m', '1y'])).toBe('3m');
  });

  it('falls back to the default for a link with no period or an unknown one', () => {
    expect(bestEffortsPeriodFromParam(undefined)).toBe(BEST_EFFORTS_DEFAULT_PERIOD);
    expect(bestEffortsPeriodFromParam('')).toBe(BEST_EFFORTS_DEFAULT_PERIOD);
    expect(bestEffortsPeriodFromParam('2y')).toBe(BEST_EFFORTS_DEFAULT_PERIOD);
    expect(bestEffortsPeriodFromParam('toString')).toBe(BEST_EFFORTS_DEFAULT_PERIOD);
    expect(bestEffortsPeriodFromParam([])).toBe(BEST_EFFORTS_DEFAULT_PERIOD);
  });

  it('writes a link the screen reads back to the same period', () => {
    for (const option of BEST_EFFORTS_PERIODS) {
      const href = bestEffortsHref(option.id);
      expect(href.startsWith('/best-efforts?')).toBe(true);
      const param = new URLSearchParams(href.split('?')[1]).get('period') ?? undefined;
      expect(bestEffortsPeriodFromParam(param)).toBe(option.id);
    }
  });
});
