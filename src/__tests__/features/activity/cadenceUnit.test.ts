/**
 * Expected behaviour: the cadence chip and the cadence stat card both label
 * the number in the unit the engine gives it in, so a run the engine already
 * gave in steps a minute reads spm on both, and a sport the engine keeps in
 * revolutions reads rpm on both, whatever the sport's name.
 */

import { renderHook } from '@testing-library/react-native';

import { useActivityStats } from '@/features/activity/components/stats/useActivityStats';
import { chartConfigsFor } from '@/features/activity/lib/chartConfig';
import { initialiseI18n } from '@/i18n';

import { CadenceUnit, type ActivityRecord, type ActivitySummary } from 'veloqrs';
import { activityRecord } from '../../__shared__/activityRecord';

const run = activityRecord({
  id: 'cadence-run',
  sportType: 'Run',
  name: 'Run',
  startDateLocal: '2026-09-05T08:00:00',
  movingTime: 3600,
});

function cadenceCard(activity: ActivityRecord, summary: ActivitySummary) {
  const { result } = renderHook(() => useActivityStats({ activity, isMetric: true, summary }));
  const card = result.current.stats.find((s) => s.title === 'Cadence');
  if (!card) throw new Error('no cadence card');
  return card;
}

describe('the cadence unit', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  it('labels the chip in the unit the engine gave the series in', () => {
    expect(chartConfigsFor('Run', CadenceUnit.StepsPerMinute).cadence.unit).toBe('spm');
    expect(chartConfigsFor('Walk', CadenceUnit.StepsPerMinute).cadence.unit).toBe('spm');
    expect(chartConfigsFor('Ride', CadenceUnit.Rpm).cadence.unit).toBe('rpm');
    expect(chartConfigsFor('Swim', CadenceUnit.StrokesPerMinute).cadence.unit).toBe('spm');
  });

  it('gives the chip no unit before the engine has named one', () => {
    expect(chartConfigsFor('Run').cadence.unit).toBeUndefined();
  });

  it('keeps the swim pace and stop speed when the cadence unit changes', () => {
    const swim = chartConfigsFor('Swim', CadenceUnit.StrokesPerMinute);
    expect(swim.pace).toEqual(chartConfigsFor('Swim').pace);
    expect(chartConfigsFor('Run', CadenceUnit.StepsPerMinute)).toBe(
      chartConfigsFor('Run', CadenceUnit.StepsPerMinute)
    );
  });

  it('shows a run the steps the engine gave, in spm', () => {
    const card = cadenceCard(run, { averageCadence: 132, cadenceUnit: CadenceUnit.StepsPerMinute });
    expect(card).toMatchObject({ value: '132', unit: 'spm' });
    expect(card.details?.[0].value).toBe('132 spm');
  });

  it('reads the unit off the engine, not the sport name', () => {
    const unnamed = activityRecord({ ...run, sportType: 'Other' });
    expect(
      cadenceCard(unnamed, { averageCadence: 60, cadenceUnit: CadenceUnit.Rpm })
    ).toMatchObject({ value: '60', unit: 'rpm' });
  });
});
