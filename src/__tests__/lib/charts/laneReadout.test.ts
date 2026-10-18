/**
 * Scenario: each stream lane's title carries a value, the activity's average
 * at rest and the sample under the finger while scrubbing.
 *
 * Expected behaviour: idle, a line lane reads its average with the average
 * mark and elevation reads the climb's gain, signed, with the gain mark; a
 * scrub reads the sample with no mark, and the absent mark past the samples.
 */

import { I18nManager } from 'react-native';

import { CHART_CONFIGS } from '@/features/activity/lib/chartConfig';
import { laneReadout } from '@/features/stats/lib/combinedPlotData';
import { ABSENT } from '@/shared/format/absent';

const watts = [200, 210, 220, 230];
const altitude = [500, 510, 505, 530];

describe('a lane readout', () => {
  it('reads a power lane at rest as its average, marked so', () => {
    expect(laneReadout(CHART_CONFIGS.power, watts, null, true, 40)).toEqual({
      mark: 'average',
      value: '215',
      unit: 'W',
    });
  });

  it('reads elevation at rest as the gain, signed and marked so', () => {
    expect(laneReadout(CHART_CONFIGS.elevation, altitude, null, true, 40)).toEqual({
      mark: 'gain',
      value: '+40',
      unit: 'm',
    });
  });

  it('converts the gain for an imperial athlete', () => {
    expect(laneReadout(CHART_CONFIGS.elevation, altitude, null, false, 40)).toEqual({
      mark: 'gain',
      value: '+131',
      unit: 'ft',
    });
  });

  it('reads the scrubbed sample with no mark', () => {
    expect(laneReadout(CHART_CONFIGS.power, watts, 2, true, 40)).toEqual({
      mark: null,
      value: '220',
      unit: 'W',
    });
    expect(laneReadout(CHART_CONFIGS.elevation, altitude, 3, true, 40)).toEqual({
      mark: null,
      value: '530',
      unit: 'm',
    });
  });

  it('reads the absent mark for a scrub past the samples or before them', () => {
    expect(laneReadout(CHART_CONFIGS.power, watts, 4, true, 0).value).toBe(ABSENT);
    expect(laneReadout(CHART_CONFIGS.power, watts, -1, true, 0).value).toBe(ABSENT);
    expect(laneReadout(CHART_CONFIGS.power, watts, 4, true, 0).mark).toBeNull();
  });

  it('reads the absent mark for a dropout under the scrub', () => {
    expect(laneReadout(CHART_CONFIGS.power, [200, NaN, 210], 1, true, 0).value).toBe(ABSENT);
  });

  it('reads the absent mark at rest when the stream has no sample to average', () => {
    expect(laneReadout(CHART_CONFIGS.heartrate, [NaN, NaN], null, true, 0)).toEqual({
      mark: 'average',
      value: ABSENT,
      unit: 'bpm',
    });
  });

  it('keeps a signed grade with its digits under a right-to-left layout', () => {
    const wasRtl = I18nManager.isRTL;
    I18nManager.isRTL = true;
    try {
      expect(laneReadout(CHART_CONFIGS.grade, [-0.2, 1], 0, true, 0).value).toBe('⁨-0.2⁩');
    } finally {
      I18nManager.isRTL = wasRtl;
    }
  });
});
