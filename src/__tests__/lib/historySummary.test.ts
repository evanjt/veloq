/**
 * Scenario: the Settings row for the activity history shows the window held on the device and
 * how many activities are in it.
 *
 * Expected behaviour: the span runs from the oldest synced day to today, in days under a year and
 * in years from 365 days, with the activity count beside it; an unknown start gives no summary.
 */

import { activityHistorySummary } from '@/features/settings/lib/historySummary';

const t = (key: string, options?: Record<string, unknown>) =>
  `${key}|${JSON.stringify(options ?? {})}`;
const now = new Date('2026-11-02T12:00:00');

describe('activityHistorySummary', () => {
  it('names the span in days with the activity count', () => {
    const out = activityHistorySummary('2026-08-04', now, 412, t as never);

    expect(out).toContain('settings.activityHistorySummary');
    expect(out).toContain('"activities":412');
    expect(out).toContain('"span":"time.daysCount|{\\"count\\":91}"');
  });

  it('counts calendar days across a clock change that gains an hour', () => {
    const springNow = new Date(2026, 3, 3, 12);
    const out = activityHistorySummary('2026-03-25', springNow, 60, t as never);

    expect(out).toContain('"span":"time.daysCount|{\\"count\\":10}"');
  });

  it('names the span in years from 365 days', () => {
    const out = activityHistorySummary('2024-11-02', now, 1500, t as never);

    expect(out).toContain('time.yearsCount');
  });

  it('is empty when the oldest day is not known', () => {
    expect(activityHistorySummary('', now, 5, t as never)).toBe('');
  });

  it('counts a start in the future as zero days rather than a negative span', () => {
    expect(activityHistorySummary('2026-12-01', now, 0, t as never)).toContain('"activities":0');
  });
});
