/**
 * Scenario: intervals.icu marks an activity that changed the accepted eFTP.
 * The app carried only the per-activity estimate, which moves on every hard
 * ride and cannot say which one intervals.icu accepted.
 *
 * Expected behaviour: a change is an activity with a non-zero rolling delta
 * and a rolling value, dated by its local start, oldest first. An estimate
 * alone, a zero delta, or a missing date is not one.
 */

import { eftpChanges, eftpChangesOn, formatEftpChange } from '@/features/fitness/lib/eftpChanges';
import type { Activity } from '@/types';

const ride = (over: Partial<Activity>): Activity =>
  ({
    id: 'a',
    name: 'Ride',
    type: 'Ride',
    start_date_local: '2026-07-14T08:00:00',
    ...over,
  }) as Activity;

describe('eftpChanges', () => {
  it('keeps the activities with a non-zero rolling delta, oldest first', () => {
    const changes = eftpChanges([
      ride({
        id: 'b',
        start_date_local: '2026-07-14T08:00:00',
        icu_rolling_ftp: 406,
        icu_rolling_ftp_delta: 20,
      }),
      ride({
        id: 'a',
        start_date_local: '2026-06-06T08:00:00',
        icu_rolling_ftp: 390,
        icu_rolling_ftp_delta: 33,
      }),
      ride({
        id: 'c',
        start_date_local: '2026-08-30T08:00:00',
        icu_rolling_ftp: 155,
        icu_rolling_ftp_delta: -12,
      }),
    ]);
    expect(changes.map((c) => [c.activityId, c.date, c.eftp, c.delta])).toEqual([
      ['a', '2026-06-06', 390, 33],
      ['b', '2026-07-14', 406, 20],
      ['c', '2026-08-30', 155, -12],
    ]);
  });

  it('is not moved by an estimate, a zero delta, a missing value or a missing date', () => {
    expect(
      eftpChanges([
        ride({ icu_pm_ftp_watts: 424 }),
        ride({ icu_rolling_ftp: 359, icu_rolling_ftp_delta: 0 }),
        ride({ icu_rolling_ftp_delta: 5 }),
        ride({ icu_rolling_ftp: 359, icu_rolling_ftp_delta: Number.NaN }),
        ride({ icu_rolling_ftp: 359, icu_rolling_ftp_delta: 5, start_date_local: '' }),
      ])
    ).toEqual([]);
    expect(eftpChanges(undefined)).toEqual([]);
    expect(eftpChanges([])).toEqual([]);
  });

  it('answers a day with its changes and a day without with none', () => {
    const changes = eftpChanges([
      ride({ id: 'a', icu_rolling_ftp: 406, icu_rolling_ftp_delta: 20 }),
      ride({
        id: 'b',
        start_date_local: '2026-07-14T18:00:00',
        icu_rolling_ftp: 410,
        icu_rolling_ftp_delta: 4,
      }),
    ]);
    expect(eftpChangesOn(changes, '2026-07-14').map((c) => c.activityId)).toEqual(['a', 'b']);
    expect(eftpChangesOn(changes, '2026-07-15')).toEqual([]);
    expect(eftpChangesOn(changes, undefined)).toEqual([]);
  });

  it('formats a rise with its plus and a fall with its minus', () => {
    const [up, down] = eftpChanges([
      ride({ id: 'a', icu_rolling_ftp: 406.4, icu_rolling_ftp_delta: 20 }),
      ride({
        id: 'b',
        start_date_local: '2026-08-30T08:00:00',
        icu_rolling_ftp: 155,
        icu_rolling_ftp_delta: -12.6,
      }),
    ]);
    expect(formatEftpChange(up)).toBe('eFTP 406 W (+20)');
    expect(formatEftpChange(down)).toBe('eFTP 155 W (-13)');
  });
});
