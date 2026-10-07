/**
 * Scenario: the fitness plot labels a day with the activities that moved the
 * accepted eFTP on it.
 *
 * Expected behaviour: a day answers its own changes and no other day's, and
 * the label carries the rise or fall with its sign.
 */

import {
  eftpChangesOn,
  formatEftpChange,
  type EftpChange,
} from '@/features/fitness/lib/eftpChanges';

describe('the markers on one day', () => {
  const markers: EftpChange[] = [
    { date: '2026-07-14', eftp: 406, delta: 20, activityId: 'a', activityName: 'Ride' },
    { date: '2026-07-14', eftp: 410, delta: 4, activityId: 'b', activityName: 'Ride' },
    { date: '2026-08-30', eftp: 155, delta: -12.6, activityId: 'c', activityName: 'Ride' },
  ];

  it('answers a day with its changes and a day without with none', () => {
    expect(eftpChangesOn(markers, '2026-07-14').map((c) => c.activityId)).toEqual(['a', 'b']);
    expect(eftpChangesOn(markers, '2026-07-15')).toEqual([]);
    expect(eftpChangesOn(markers, undefined)).toEqual([]);
  });

  it('formats a rise with its plus and a fall with its minus', () => {
    expect(formatEftpChange({ ...markers[0], eftp: 406.4 }, 'W')).toBe('eFTP 406 W (+20)');
    expect(formatEftpChange(markers[2], 'W')).toBe('eFTP 155 W (-13)');
  });
});
