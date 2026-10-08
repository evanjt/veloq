/**
 * Scenario: the engine's streams carry NaN where a sensor dropped out.
 *
 * Expected behaviour: a dropout is excluded from every chip figure. It neither
 * pulls the mean or the range towards 0 nor differences into elevation gain.
 */
import { CHART_CONFIGS } from '@/features/activity/lib/chartConfig';
import { computeAllAverages } from '@/features/stats/lib/combinedPlotData';
import type { ActivityStreams } from '@/types';

function chips(streams: ActivityStreams) {
  const values = computeAllAverages(CHART_CONFIGS, streams, true);
  return Object.fromEntries(values.map((v) => [v.id, v]));
}

describe('stream null handling', () => {
  it('averages heart rate over the samples the strap recorded', () => {
    const { heartrate } = chips({ heartrate: [NaN, 150, 160, 170] });
    expect(heartrate.value).toBe('160');
    expect(heartrate.maxValueWidth).toBe('170');
  });

  it('does not fabricate elevation gain across a dropout', () => {
    const { elevation } = chips({ altitude: [100, NaN, 100, 110] });
    expect(elevation.value).toBe('+10');
    expect(elevation.maxValueWidth).toBe('+10');
  });

  it('leaves a chart out when every sample is a dropout', () => {
    const values = chips({ heartrate: [NaN, NaN], altitude: [NaN] });
    expect(values.heartrate).toBeUndefined();
    expect(values.elevation).toBeUndefined();
  });
});
