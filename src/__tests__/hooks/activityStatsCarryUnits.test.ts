/**
 * Scenario: a ride with an average heart rate of 152, 245 W and 820 kcal. The
 * tiles read '152', '245' and '820' with no unit, so 820 could be kJ or kcal,
 * the power card wrote '245W' while the lap list wrote '245 W', and the heart
 * rate card named its maximum 'Peak' where the power card said 'Max'.
 *
 * Expected behaviour: every tile carries its unit, every value in a card is
 * spaced from its symbol, and the maximum has one name.
 */

import { renderHook } from '@testing-library/react-native';

import { useActivityStats } from '@/features/activity/components/stats/useActivityStats';
import { initialiseI18n, i18n } from '@/i18n';
import type { Activity, WellnessData } from '@/types';

const ride = {
  id: 'ride-units',
  type: 'Ride',
  name: 'Ride',
  start_date_local: '2026-09-05T08:00:00',
  moving_time: 5400,
  average_heartrate: 152,
  max_heartrate: 181,
  icu_average_watts: 245,
  icu_pm_p_max: 812,
  icu_pm_ftp_watts: 262,
  icu_ftp: 280,
  icu_training_load: 96,
  icu_intensity: 88,
  calories: 820,
} as Activity;

const wellness = { id: '2026-09-05', ctl: 60, atl: 70, hrv: 48.4, sleepScore: 85 } as WellnessData;

function stats() {
  const { result } = renderHook(() =>
    useActivityStats({ activity: ride, wellness, isMetric: true, maxHR: 190 })
  );
  return result.current.stats;
}

function card(title: string) {
  const found = stats().find((s) => s.title === title);
  if (!found) throw new Error(`no ${title} card`);
  return found;
}

function row(title: string, label: string) {
  return card(title).details?.find((d) => d.label === label)?.value;
}

describe('the activity stat tiles', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  it('give heart rate, energy and power a unit beside the value', () => {
    expect(card('Heart rate')).toMatchObject({ value: '152', unit: 'bpm' });
    expect(card('Energy')).toMatchObject({ value: '820', unit: 'kcal' });
    expect(card('Power')).toMatchObject({ value: '245', unit: 'W' });
  });

  it('never write a power value against its symbol', () => {
    const texts = stats().flatMap((s) => [
      s.value,
      s.context ?? '',
      ...(s.details ?? []).map((d) => d.value),
    ]);
    expect(texts.filter((text) => /\dW\b/.test(text))).toEqual([]);
    expect(card('Power').context).toBe("This activity's eFTP 262 W");
    expect(row('Power', 'Average')).toBe('245 W');
    expect(row('Power', 'Max')).toBe('812 W');
  });

  it('reads the maximum power in the context line when there is no estimate', () => {
    const { result } = renderHook(() =>
      useActivityStats({
        activity: { ...ride, icu_pm_ftp_watts: undefined } as Activity,
        isMetric: true,
        maxHR: 190,
      })
    );
    const power = result.current.stats.find((s) => s.title === 'Power');
    expect(power?.context).toBe('Max 812 W');
  });

  it('names the maximum heart rate Max, as the power card does', () => {
    expect(row('Heart rate', 'Max')).toBe('181 bpm');
    expect(i18n.exists('activity.stats.peak')).toBe(false);
  });

  it('print HRV in ms through the one formatter on both cards', () => {
    expect(row('Heart rate', 'HRV that day')).toBe('48 ms');
    expect(row('Your form', 'HRV')).toBe('48 ms');
  });

  it('print energy in kcal and its rate per hour', () => {
    expect(card('Energy').context).toBe('547 kcal/h');
    expect(row('Energy', 'Calories burned')).toBe('820 kcal');
  });

  it('name the intensity factor through the locale', () => {
    expect(card('Training load').context).toBe('IF 88%');
  });

  it('print the sleep score as a score, as Health does', () => {
    expect(row('Your form', 'Sleep score')).toBe('85');
  });
});
