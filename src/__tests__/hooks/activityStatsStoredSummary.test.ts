/**
 * Expected behaviour: the stat cards show the summary the engine read from the
 * stored activity, average and max speed or pace, moving and elapsed time and
 * cadence, whether or not the activity's streams were ever fetched. A pace is
 * the engine's text, and the average shown is the one the engine chose.
 */

import { renderHook } from '@testing-library/react-native';

import { useActivityStats } from '@/features/activity/components/stats/useActivityStats';
import { initialiseI18n } from '@/i18n';
import { formatDuration, formatSpeed } from '@/shared/format/format';

import { FfiCadenceUnit, type ActivityRecord, type ActivitySummary } from 'veloqrs';
import { activityRecord } from '../__shared__/activityRecord';

const ride = activityRecord({
  id: 'ride-summary',
  sportType: 'Ride',
  name: 'Ride',
  startDateLocal: '2026-09-05T08:00:00',
  movingTime: 3600,
});

const rideSummary: ActivitySummary = {
  movingTime: 3600,
  elapsedTime: 3720,
  averageSpeed: 8.2,
  shownAverageSpeed: 8.2,
  maxSpeed: 15.4,
  averageCadence: 88.5,
  cadenceUnit: FfiCadenceUnit.Rpm,
};

function stats(activity: ActivityRecord, summary: ActivitySummary | undefined, isMetric = true) {
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
    expect(card(list, 'Speed').value).toBe(formatSpeed(8.2, true));
    expect(card(list, 'Speed').context).toBe(`Max ${formatSpeed(15.4, true)}`);
    expect(row(list, 'Speed', 'Average')).toBe(formatSpeed(8.2, true));
    expect(row(list, 'Speed', 'Max')).toBe(formatSpeed(15.4, true));
  });

  it('shows the average the engine chose, not the stored one', () => {
    const list = stats(ride, { ...rideSummary, shownAverageSpeed: 10000 / 3600 });
    expect(card(list, 'Speed').value).toBe(formatSpeed(10000 / 3600, true));
    expect(row(list, 'Speed', 'Average')).toBe(formatSpeed(10000 / 3600, true));
  });

  vaultIt('reads speed in the athlete units', () => {
    const list = stats(ride, rideSummary, false);
    expect(card(list, 'Speed').value).toBe(formatSpeed(8.2, false));
  });

  it('gives moving and elapsed time apart', () => {
    const list = stats(ride, rideSummary);
    expect(row(list, 'Speed', 'Moving time')).toBe(formatDuration(3600));
    expect(row(list, 'Speed', 'Elapsed time')).toBe(formatDuration(3720));
  });

  it('shows a run the pace text the engine wrote, not a pace worked out from its speed', () => {
    const run = activityRecord({ ...ride, sportType: 'Run' });
    const summary: ActivitySummary = {
      ...rideSummary,
      averageSpeed: 3,
      shownAverageSpeed: 3,
      shownAveragePaceMetricText: '5:34',
      shownAveragePaceImperialText: '8:57',
      maxSpeed: 4,
      maxPaceMetricText: '4:11',
      maxPaceImperialText: '6:43',
      averageCadence: 172,
    };
    const list = stats(run, summary);
    expect(list.find((s) => s.title === 'Speed')).toBeUndefined();
    expect(card(list, 'Pace').value).toBe('5:34 /km');
    expect(card(list, 'Pace').context).toBe('Max 4:11 /km');
    expect(row(list, 'Pace', 'Max')).toBe('4:11 /km');
    expect(card(stats(run, summary, false), 'Pace').value).toBe('8:57 /mi');
    expect(row(stats(run, summary, false), 'Pace', 'Max')).toBe('6:43 /mi');
  });

  it('shows cadence in the unit of the sport', () => {
    expect(card(stats(ride, rideSummary), 'Cadence')).toMatchObject({ value: '89', unit: 'rpm' });
    const run = activityRecord({ ...ride, sportType: 'Run' });
    const runSummary = {
      ...rideSummary,
      averageCadence: 172,
      cadenceUnit: FfiCadenceUnit.StepsPerMinute,
    };
    expect(card(stats(run, runSummary), 'Cadence')).toMatchObject({
      value: '172',
      unit: 'spm',
    });
  });

  it('leaves out what the activity did not measure', () => {
    const list = stats(ride, { movingTime: 1800, cadenceUnit: FfiCadenceUnit.Rpm });
    expect(list.find((s) => s.title === 'Speed')).toBeUndefined();
    expect(list.find((s) => s.title === 'Cadence')).toBeUndefined();
  });

  it('shows a speed card with no max when only the average was stored', () => {
    const list = stats(ride, {
      averageSpeed: 8.2,
      shownAverageSpeed: 8.2,
      cadenceUnit: FfiCadenceUnit.Rpm,
    });
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
