/**
 * Scenario: intervals.icu streams carry JSON nulls where a sensor dropped out.
 *
 * Expected behaviour: a dropout is excluded from every chip figure. It neither
 * pulls the mean or the range towards 0 nor differences into elevation gain.
 */
import { CHART_CONFIGS } from '@/features/activity/lib/chartConfig';
import { parseStreams } from '@/features/activity/lib/streams';
import { computeAllAverages } from '@/features/stats/lib/combinedPlotData';
import type { RawStreamItem } from '@/types';

function chips(raw: RawStreamItem[]) {
  const values = computeAllAverages(CHART_CONFIGS, parseStreams(raw), true);
  return Object.fromEntries(values.map((v) => [v.id, v]));
}

describe('stream null handling', () => {
  it('averages heart rate over the samples the strap recorded', () => {
    const { heartrate } = chips([
      { type: 'heartrate', data: [null, 150, 160, 170] } as unknown as RawStreamItem,
    ]);
    expect(heartrate.value).toBe('160');
    expect(heartrate.maxValueWidth).toBe('170');
  });

  it('does not fabricate elevation gain across a dropout', () => {
    const { elevation } = chips([
      { type: 'altitude', data: [100, null, 100, 110] } as unknown as RawStreamItem,
    ]);
    expect(elevation.value).toBe('+10');
    expect(elevation.maxValueWidth).toBe('+10');
  });

  it('leaves a chart out when every sample is a dropout', () => {
    const values = chips([
      { type: 'heartrate', data: [null, null] } as unknown as RawStreamItem,
      { type: 'altitude', data: [null] } as unknown as RawStreamItem,
    ]);
    expect(values.heartrate).toBeUndefined();
    expect(values.elevation).toBeUndefined();
  });
});
