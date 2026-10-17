/**
 * Scenario: an imperial athlete rides at 30 °C, feeling like 34 °C, into a
 * 5 m/s wind, and an athlete whose activity carries no HR zones reads the heart
 * rate card beside the zones chart.
 * Expected behaviour: the Conditions card speaks the athlete's units as the feed
 * card does, and the heart rate card divides by the same max HR the zones chart
 * is handed by the detail screen read, never a literal 200. Over the engine's
 * default it names the default and grades nothing.
 */

import { renderHook } from '@testing-library/react-native';

import { useActivityStats } from '@/features/activity/components/stats/useActivityStats';
import type { Activity } from '@/types';
import { MaxHrSource } from 'veloqrs';

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

// A max HR given without a source is the athlete's own sport setting.
async function stat(
  activity: Activity,
  title: string,
  options: { isMetric?: boolean; maxHR?: number; maxHrSource?: MaxHrSource }
) {
  const isMetric = options.isMetric ?? true;
  const { maxHR } = options;
  const maxHrSource = options.maxHrSource ?? MaxHrSource.SportSettings;
  const { result } = await renderHook(() =>
    useActivityStats({ activity, isMetric, maxHR, maxHrSource })
  );
  return result.current.stats.find((s) => s.title === title);
}

function row(card: Awaited<ReturnType<typeof stat>>, label: string) {
  return card?.details?.find((d) => d.label === label)?.value;
}

describe('the Conditions card', () => {
  it('reads Fahrenheit and mph for an imperial athlete', async () => {
    const card = await stat(ride, 'activity.stats.conditions', { isMetric: false });
    expect(card?.value).toBe('86°F');
    expect(row(card, 'activity.stats.temperature')).toBe('86°F');
    expect(row(card, 'activity.stats.feelsLikeLabel')).toBe('93°F');
    expect(row(card, 'activity.stats.wind')).toBe('11.2 mph');
    expect(card?.context).toContain('activity.stats.feelsLike:{"temp":"93°F"}');
    expect(card?.context).toContain('activity.stats.windSpeed:{"speed":"11.2 mph"}');
  });

  it('reads Celsius and km/h for a metric athlete', async () => {
    const card = await stat(ride, 'activity.stats.conditions', { isMetric: true });
    expect(card?.value).toBe('30°C');
    expect(row(card, 'activity.stats.temperature')).toBe('30°C');
    expect(row(card, 'activity.stats.feelsLikeLabel')).toBe('34°C');
    expect(row(card, 'activity.stats.wind')).toBe('18.0 km/h');
    expect(card?.context).toContain('activity.stats.feelsLike:{"temp":"34°C"}');
    expect(card?.context).toContain('activity.stats.windSpeed:{"speed":"18.0 km/h"}');
  });
});

describe('the Power card', () => {
  it('uses the engine power precedence when both fields differ', async () => {
    const activity = { ...ride, average_watts: 198, icu_average_watts: 205 } as Activity;
    const card = await stat(activity, 'activity.power', {});

    expect(card?.value).toBe('205');
    expect(row(card, 'activity.stats.average')).toBe('205 W');
  });
});

describe('one max HR for the stat card and the zones chart', () => {
  it('shows the list body peak heart rate', async () => {
    const activity = { ...ride, average_heartrate: 150, max_heartrate: 184 } as Activity;
    const card = await stat(activity, 'activity.heartRate', { maxHR: 190 });
    expect(row(card, 'activity.stats.maxLabel')).toBe('184 bpm');
  });
  const hr = { ...ride, average_heartrate: 150 } as Activity;

  // The precedence behind the max HR is the engine's, pinned in the screen
  // read's own tests. The card divides by whatever the read resolved.
  it('divides by the max HR the detail screen read resolved', async () => {
    const card = await stat(hr, 'activity.heartRate', { maxHR: 185 });
    expect(row(card, 'activity.stats.percentOfMaxHRLabel')).toBe('81%');
  });

  it('divides by the default, not 200, with no settings at all, and names it', async () => {
    const card = await stat(hr, 'activity.heartRate', {
      maxHR: 190,
      maxHrSource: MaxHrSource.Default,
    });
    expect(row(card, 'activity.stats.percentOfDefaultMaxHRLabel:{"value":190}')).toBe('79%');
    expect(row(card, 'activity.stats.percentOfMaxHRLabel')).toBeUndefined();
  });

  it('carries no percent of max before the screen read answers', async () => {
    const card = await stat(hr, 'activity.heartRate', {});
    expect(card?.value).toBe('150');
    expect(card?.context).toBeUndefined();
    expect(card?.details?.some((d) => d.label.includes('percentOf'))).toBe(false);
  });

  it('divides by the resolved bound, not the default, for a zoned activity', async () => {
    const zoned = { ...hr, icu_hr_zones: [120, 140, 160, 175] } as Activity;
    const card = await stat(zoned, 'activity.heartRate', {
      maxHR: 175,
      maxHrSource: MaxHrSource.ActivityZones,
    });
    expect(row(card, 'activity.stats.percentOfMaxHRLabel')).toBe('86%');
  });
});

describe('the Power card', () => {
  it('shows the measured peak power field', async () => {
    const activity = { ...ride, icu_average_watts: 210, icu_pm_p_max: 1012 } as Activity;
    const card = await stat(activity, 'activity.power', {});
    expect(row(card, 'activity.stats.maxLabel')).toBe('1012 W');
  });
});

describe('activity stat card marks', () => {
  it('keys heart rate and power to their streams at every value', async () => {
    for (const average_heartrate of [135, 153, 171]) {
      const activity = { ...ride, average_heartrate, icu_average_watts: 220 } as Activity;
      const { result } = await renderHook(() =>
        useActivityStats({
          activity,
          maxHR: 180,
          maxHrSource: MaxHrSource.SportSettings,
          isMetric: true,
        })
      );
      const heartRate = result.current.stats.find((item) => item.title === 'activity.heartRate');
      const power = result.current.stats.find((item) => item.title === 'activity.power');

      expect(heartRate?.stream).toBe('heartrate');
      expect(power?.stream).toBe('power');
    }
  });
});

describe('the New ground card', () => {
  const withGround = async (fraction: number, tiles: number, newTiles: number) => {
    const { result } = await renderHook(() =>
      useActivityStats({
        activity: ride,
        isMetric: true,
        newGround: { fraction, tiles, newTiles, badge: null },
      })
    );
    return result.current.stats.find((s) => s.title === 'activity.stats.newGround');
  };

  it('reads the share of tiles and names what it counts', async () => {
    const card = await withGround(0.625, 8, 5);

    expect(card?.value).toBe('62%');
    expect(card?.context).toBe('activity.stats.newGroundContext');
    expect(row(card, 'activity.stats.newGroundTiles')).toBe('8');
    expect(row(card, 'activity.stats.newGroundNewTiles')).toBe('5');
  });

  it('does not round a ride one tile short of entirely new up to 100%', async () => {
    expect((await withGround(249 / 250, 250, 249))?.value).toBe('99%');
    expect((await withGround(1, 250, 250))?.value).toBe('100%');
  });

  it('is left out when the engine has no coverage for the activity', async () => {
    expect(await stat(ride, 'activity.stats.newGround', {})).toBeUndefined();
  });
});
