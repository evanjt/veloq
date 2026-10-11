/**
 * Scenario: an imperial athlete rides at 30 °C, feeling like 34 °C, into a
 * 5 m/s wind, and an athlete whose activity carries no HR zones reads the heart
 * rate card beside the zones chart.
 * Expected behaviour: the Conditions card speaks the athlete's units as the feed
 * card does, and the heart rate card divides by the same max HR the zones chart
 * resolves: activity zones, then the sport setting, then the local store, then
 * the default. Never a literal 200.
 */

import { renderHook } from '@testing-library/react-native';

import { useActivityStats } from '@/features/activity/components/stats/useActivityStats';
import { DEFAULT_MAX_HR } from '@/features/activity/lib/hrZones';
import { colors, darkColors } from '@/theme';
import type { Activity } from '@/types';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());

const ride = {
  id: 'a1',
  type: 'Ride',
  name: 'Ride',
  start_date_local: '2026-09-05T08:00:00',
  average_weather_temp: 30,
  apparent_temperature: 34,
  average_wind_speed: 5,
  has_weather: true,
} as Activity;

// A card rendered with no max HR takes the default, which is what the detail
// screen read resolves with no zones, no sport setting and no local store.
function stat(activity: Activity, title: string, options: { isMetric?: boolean; maxHR?: number }) {
  const isMetric = options.isMetric ?? true;
  const maxHR = options.maxHR ?? DEFAULT_MAX_HR;
  const { result } = renderHook(() => useActivityStats({ activity, isMetric, maxHR }));
  return result.current.stats.find((s) => s.title === title);
}

function row(card: ReturnType<typeof stat>, label: string) {
  return card?.details?.find((d) => d.label === label)?.value;
}

describe('the Conditions card', () => {
  it('reads Fahrenheit and mph for an imperial athlete', () => {
    const card = stat(ride, 'activity.stats.conditions', { isMetric: false });
    expect(card?.value).toBe('86°F');
    expect(row(card, 'activity.stats.temperature')).toBe('86°F');
    expect(row(card, 'activity.stats.feelsLikeLabel')).toBe('93°F');
    expect(row(card, 'activity.stats.wind')).toBe('11.2 mph');
    expect(card?.context).toContain('activity.stats.feelsLike:{"temp":"93°F"}');
    expect(card?.context).toContain('activity.stats.windSpeed:{"speed":"11.2 mph"}');
  });

  it('reads Celsius and km/h for a metric athlete', () => {
    const card = stat(ride, 'activity.stats.conditions', { isMetric: true });
    expect(card?.value).toBe('30°C');
    expect(row(card, 'activity.stats.temperature')).toBe('30°C');
    expect(row(card, 'activity.stats.feelsLikeLabel')).toBe('34°C');
    expect(row(card, 'activity.stats.wind')).toBe('18.0 km/h');
    expect(card?.context).toContain('activity.stats.feelsLike:{"temp":"34°C"}');
    expect(card?.context).toContain('activity.stats.windSpeed:{"speed":"18.0 km/h"}');
  });
});

describe('the Power card', () => {
  it('uses the engine power precedence when both fields differ', () => {
    const activity = { ...ride, average_watts: 198, icu_average_watts: 205 } as Activity;
    const card = stat(activity, 'activity.power', {});

    expect(card?.value).toBe('205');
    expect(row(card, 'activity.stats.average')).toBe('205W');
  });
});

describe('one max HR for the stat card and the zones chart', () => {
  it('shows the list body peak heart rate', () => {
    const activity = { ...ride, average_heartrate: 150, max_heartrate: 184 } as Activity;
    const card = stat(activity, 'activity.heartRate', { maxHR: 190 });
    expect(row(card, 'activity.stats.peak')).toBe('184 bpm');
  });
  const hr = { ...ride, average_heartrate: 150 } as Activity;

  // The precedence behind the max HR is the engine's, pinned in the screen
  // read's own tests. The card divides by whatever the read resolved.
  it('divides by the max HR the detail screen read resolved', () => {
    const card = stat(hr, 'activity.heartRate', { maxHR: 185 });
    expect(row(card, 'activity.stats.percentOfMaxHRLabel')).toBe('81%');
  });

  it('divides by the default, not 200, with no settings at all', () => {
    const card = stat(hr, 'activity.heartRate', {});
    expect(row(card, 'activity.stats.percentOfMaxHRLabel')).toBe(
      `${Math.round((150 / DEFAULT_MAX_HR) * 100)}%`
    );
  });

  it('divides by the resolved bound, not the default, for a zoned activity', () => {
    const zoned = { ...hr, icu_hr_zones: [120, 140, 160, 175] } as Activity;
    const card = stat(zoned, 'activity.heartRate', { maxHR: 175 });
    expect(row(card, 'activity.stats.percentOfMaxHRLabel')).toBe('86%');
  });
});

describe('the Power card', () => {
  it('shows the measured peak power field', () => {
    const activity = { ...ride, icu_average_watts: 210, icu_pm_p_max: 1012 } as Activity;
    const card = stat(activity, 'activity.power', {});
    expect(row(card, 'activity.stats.maxLabel')).toBe('1012W');
  });
});

describe('activity stat card marks', () => {
  it.each([
    ['light', false, colors],
    ['dark', true, darkColors],
  ])('uses readable %s theme marks for heart rate and power', (_theme, isDark, palette) => {
    for (const average_heartrate of [135, 153, 171]) {
      const activity = { ...ride, average_heartrate, icu_average_watts: 220 } as Activity;
      const { result } = renderHook(() =>
        useActivityStats({ activity, maxHR: 180, isDark, isMetric: true })
      );
      const heartRate = result.current.stats.find((item) => item.title === 'activity.heartRate');
      const power = result.current.stats.find((item) => item.title === 'activity.power');

      expect(heartRate?.color).toBe(palette.chartPinkText);
      expect(power?.color).toBe(palette.chartPurpleText);
    }
  });
});

describe('the New ground card', () => {
  const withGround = (fraction: number, tiles: number, newTiles: number) => {
    const { result } = renderHook(() =>
      useActivityStats({
        activity: ride,
        isMetric: true,
        maxHR: DEFAULT_MAX_HR,
        newGround: { fraction, tiles, newTiles, badge: null },
      })
    );
    return result.current.stats.find((s) => s.title === 'activity.stats.newGround');
  };

  it('reads the share of tiles and names what it counts', () => {
    const card = withGround(0.625, 8, 5);

    expect(card?.value).toBe('62%');
    expect(card?.context).toBe('activity.stats.newGroundContext');
    expect(row(card, 'activity.stats.newGroundTiles')).toBe('8');
    expect(row(card, 'activity.stats.newGroundNewTiles')).toBe('5');
  });

  it('does not round a ride one tile short of entirely new up to 100%', () => {
    expect(withGround(249 / 250, 250, 249)?.value).toBe('99%');
    expect(withGround(1, 250, 250)?.value).toBe('100%');
  });

  it('is left out when the engine has no coverage for the activity', () => {
    expect(stat(ride, 'activity.stats.newGround', {})).toBeUndefined();
  });
});
