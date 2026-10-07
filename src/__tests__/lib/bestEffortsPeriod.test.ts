import {
  BEST_EFFORTS_DEFAULT_PERIOD,
  BEST_EFFORTS_PERIODS,
  bestEffortsDays,
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
});
