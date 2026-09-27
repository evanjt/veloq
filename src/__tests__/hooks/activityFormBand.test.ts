/**
 * Scenario: one athlete, one day, one TSB, shown on the fitness tab and on the
 * activity card.
 * Expected behaviour: both surfaces colour the number from the same five-band
 * ladder, `getFormZone` and the form-zone text family, on every band and at
 * every boundary, and a card with no wellness shows no form stat at all. The
 * number is text, so it takes the text variant and not the band fill.
 */

import { renderHook } from '@testing-library/react-native';

import { useActivityStats } from '@/features/activity/components/stats/useActivityStats';
import {
  getFormZone,
  FORM_ZONE_TEXT_COLORS,
  FORM_ZONE_TEXT_COLORS_DARK,
  formZoneLabel,
} from '@/features/fitness/lib/fitness';
import type { Activity, WellnessData } from '@/types';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const activity = {
  id: 'a1',
  type: 'Ride',
  name: 'Ride',
  start_date_local: '2026-09-05T08:00:00',
} as Activity;

function formStat(wellness?: WellnessData, isDark = false) {
  const { result } = renderHook(() => useActivityStats({ activity, wellness, isDark }));
  return result.current.stats.find((s) => s.title === 'activity.stats.yourForm');
}

function loadStat(intensity: number) {
  const withLoad = { ...activity, icu_training_load: 60, icu_intensity: intensity } as Activity;
  const { result } = renderHook(() => useActivityStats({ activity: withLoad }));
  return result.current.stats.find((s) => s.title === 'activity.stats.trainingLoad');
}

describe('the activity card form band', () => {
  it.each([-35, -30, -20, -10, -5, 0, 5, 10, 25, 30])(
    'colours a TSB of %d from the fitness ladder',
    (tsb) => {
      const stat = formStat({ ctl: 50, atl: 50 - tsb } as WellnessData);
      expect(stat).toBeDefined();
      expect(stat?.color).toBe(FORM_ZONE_TEXT_COLORS[getFormZone(tsb)]);

      const dark = formStat({ ctl: 50, atl: 50 - tsb } as WellnessData, true);
      expect(dark?.color).toBe(FORM_ZONE_TEXT_COLORS_DARK[getFormZone(tsb)]);
    }
  );

  it('shows no form stat without wellness', () => {
    expect(formStat(undefined)).toBeUndefined();
    expect(formStat({ ctl: 50 } as WellnessData)).toBeUndefined();
  });
});

/**
 * Expected behaviour: the icon's colour bands the session and the context line
 * names the band, so neither the intensity nor the form zone reaches the
 * athlete through hue alone.
 */
describe('a card that colours by band also names it', () => {
  it.each([
    [60, 'activity.stats.intensityEasy'],
    [70, 'activity.stats.intensityEasy'],
    [78, 'activity.stats.intensityModerate'],
    [85, 'activity.stats.intensityModerate'],
    [92, 'activity.stats.intensityHard'],
    [100, 'activity.stats.intensityHard'],
    [105, 'activity.stats.intensityVeryHard'],
  ])('names the band for an IF of %d', (intensity, key) => {
    expect(loadStat(intensity)?.context).toBe(`IF ${intensity}% · ${key}`);
  });

  it.each([-35, -20, 0, 10, 30])('names the form zone at a TSB of %d', (tsb) => {
    const stat = formStat({ ctl: 50, atl: 50 - tsb } as WellnessData);
    expect(stat?.context).toBe(formZoneLabel(getFormZone(tsb)));
  });
});
