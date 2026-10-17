/**
 * Expected behaviour: the stat cards show the summary the engine read from the
 * stored activity, average and max speed or pace, moving and elapsed time and
 * cadence, whether or not the activity's streams were ever fetched.
 */

import { renderHook } from '@testing-library/react-native';

import { useActivityStats } from '@/features/activity/components/stats/useActivityStats';
import { initialiseI18n } from '@/i18n';
import { formatDuration, formatSportSpeed } from '@/shared/format/format';
import type { Activity } from '@/types';
import { CadenceUnit, type ActivitySummary } from 'veloqrs';

const ride = {
  id: 'ride-summary',
  type: 'Ride',
  name: 'Ride',
  start_date_local: '2026-09-05T08:00:00',
  moving_time: 3600,
  elapsed_time: 3720,
  average_speed: 8.2,
  max_speed: 15.4,
  average_cadence: 88.5,
} as Activity;

const rideSummary: ActivitySummary = {
  movingTime: 3600,
  elapsedTime: 3720,
  averageSpeed: 8.2,
  maxSpeed: 15.4,
  averageCadence: 88.5,
  cadenceUnit: CadenceUnit.Rpm,
};

function stats(activity: Activity, summary: ActivitySummary | undefined, isMetric = true) {
  const { result } = renderHook(() => useActivityStats({ activity, isMetric, summary }));
  return result.current.stats;
}

function card(list: ReturnType<typeof stats>, title: string) {
  const found = list.find((s) => s.title === title);
  if (!found) throw new Error(`no ${title} card in ${list.map((s) => s.title).join(', ')}`);
  return found;
}

function row(list: ReturnType<typeof stats>, title: string, label: string) {
  return card(list, title).details?.find((d) => d.label === label)?.value;
}

describe('the stored summary on the activity stat cards', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  it('shows a ride with no streams its average and max speed', () => {
    const list = stats(ride, rideSummary);
    expect(card(list, 'Speed').value).toBe(formatSportSpeed(8.2, 'Ride', true));
    expect(card(list, 'Speed').context).toBe(`Max ${formatSportSpeed(15.4, 'Ride', true)}`);
    expect(row(list, 'Speed', 'Average')).toBe(formatSportSpeed(8.2, 'Ride', true));
    expect(row(list, 'Speed', 'Max')).toBe(formatSportSpeed(15.4, 'Ride', true));
  });

  it('reads speed in the athlete units', () => {
    const list = stats(ride, rideSummary, false);
    expect(card(list, 'Speed').value).toBe(formatSportSpeed(8.2, 'Ride', false));
  });

  it('gives moving and elapsed time apart', () => {
    const list = stats(ride, rideSummary);
    expect(row(list, 'Speed', 'Moving time')).toBe(formatDuration(3600));
    expect(row(list, 'Speed', 'Elapsed time')).toBe(formatDuration(3720));
  });

  it('shows a run its pace, not its speed', () => {
    const run = { ...ride, type: 'Run' } as Activity;
    const list = stats(run, { ...rideSummary, averageSpeed: 3, averageCadence: 172 });
    expect(list.find((s) => s.title === 'Speed')).toBeUndefined();
    expect(card(list, 'Pace').value).toBe(formatSportSpeed(3, 'Run', true));
  });

  it('shows cadence in the unit of the sport', () => {
    expect(card(stats(ride, rideSummary), 'Cadence')).toMatchObject({ value: '89', unit: 'rpm' });
    const run = { ...ride, type: 'Run' } as Activity;
    const runSummary = {
      ...rideSummary,
      averageCadence: 172,
      cadenceUnit: CadenceUnit.StepsPerMinute,
    };
    expect(card(stats(run, runSummary), 'Cadence')).toMatchObject({
      value: '172',
      unit: 'spm',
    });
  });

  it('leaves out what the activity did not measure', () => {
    const list = stats(ride, { movingTime: 1800, cadenceUnit: CadenceUnit.Rpm });
    expect(list.find((s) => s.title === 'Speed')).toBeUndefined();
    expect(list.find((s) => s.title === 'Cadence')).toBeUndefined();
  });

  it('shows a speed card with no max when only the average was stored', () => {
    const list = stats(ride, { averageSpeed: 8.2, cadenceUnit: CadenceUnit.Rpm });
    expect(card(list, 'Speed').context).toBeUndefined();
    expect(row(list, 'Speed', 'Max')).toBeUndefined();
    expect(row(list, 'Speed', 'Elapsed time')).toBeUndefined();
  });

  it('shows nothing from the summary before the detail read lands', () => {
    const list = stats(ride, undefined);
    expect(list.find((s) => s.title === 'Speed')).toBeUndefined();
    expect(list.find((s) => s.title === 'Cadence')).toBeUndefined();
  });
});
