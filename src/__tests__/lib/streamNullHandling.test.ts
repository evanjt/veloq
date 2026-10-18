/**
 * Scenario: the engine's streams carry NaN where a sensor dropped out.
 *
 * Expected behaviour: a dropout is excluded from every lane readout. It
 * neither pulls the mean towards 0 nor differences into elevation gain.
 */
import { CHART_CONFIGS, type ChartTypeId } from '@/features/activity/lib/chartConfig';
import { laneReadout } from '@/features/stats/lib/combinedPlotData';
import { streamsFromArrays, type StreamArrays } from '@/features/activity/lib/streams';
import { ABSENT } from '@/shared/format/absent';

function idle(id: ChartTypeId, streams: StreamArrays, elevationGain = 0) {
  const config = CHART_CONFIGS[id];
  const rawData = config.getStream?.(streamsFromArrays(streams)) ?? [];
  return laneReadout(config, rawData, null, true, elevationGain);
}

describe('stream null handling', () => {
  it('averages heart rate over the samples the strap recorded', () => {
    expect(idle('heartrate', { heartrate: [NaN, 150, 160, 170] }).value).toBe('160');
  });

  it('shows the activity gain across a dropout', () => {
    expect(idle('elevation', { altitude: [100, NaN, 100, 110] }, 10).value).toBe('+10');
  });

  it('reads the absent mark when every sample is a dropout', () => {
    expect(idle('heartrate', { heartrate: [NaN, NaN] }).value).toBe(ABSENT);
  });
});
