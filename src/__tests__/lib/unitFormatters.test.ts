/**
 * Scenario: power, energy, heart rate and HRV were written by hand at each
 * site, so one statistic read '812W' on one screen and '812 W' on the next,
 * W' read '12.8kJ', and energy was 'cal' on a card and 'kcal' on the tile.
 *
 * Expected behaviour: each quantity has one formatter, the SI symbol separated
 * from the value by a space, and energy in food calories reads kcal.
 */

import { changeLanguage, initialiseI18n } from '@/i18n';
import {
  formatCadence,
  formatCalorieRate,
  formatCalories,
  formatDistance,
  formatElevation,
  formatEnergy,
  formatHeartRate,
  formatHeartRateRange,
  formatHrv,
  formatPower,
  formatPowerRange,
  formatTemperature,
} from '@/shared/format/format';
import { ABSENT } from '@/shared/format/absent';

describe('formatPowerRange', () => {
  vaultIt('prints a closed zone with one symbol after the range', () => {
    expect(formatPowerRange(0, 150)).toBe('0-150 W');
    expect(formatPowerRange(200.4, 249.6)).toBe('200-250 W');
  });

  vaultIt('prints the open top zone as its lower bound and up', () => {
    expect(formatPowerRange(300, null)).toBe('300+ W');
  });

  it('never leaks an invalid bound', () => {
    expect(formatPowerRange(NaN, 150)).toBe('0-150 W');
    expect(formatPowerRange(-5, Infinity)).toBe('0+ W');
  });
});

describe('formatHeartRateRange', () => {
  vaultIt('prints a zone with one symbol after the range', () => {
    expect(formatHeartRateRange(120, 140)).toBe('120-140 bpm');
  });

  it('never leaks an invalid bound', () => {
    expect(formatHeartRateRange(NaN, 140)).toBe('0-140 bpm');
  });

  vaultIt('prints an open top zone as its lower bound and a plus', () => {
    expect(formatHeartRateRange(180, null)).toBe('180+ bpm');
  });
});

describe('formatEnergy', () => {
  vaultIt('prints joules as kilojoules with a space', () => {
    expect(formatEnergy(12800)).toBe('12.8 kJ');
    expect(formatEnergy(19655)).toBe('19.7 kJ');
  });

  vaultIt('leaves a whole number whole', () => {
    expect(formatEnergy(11000)).toBe('11 kJ');
    expect(formatEnergy(0)).toBe('0 kJ');
  });

  it.each([NaN, Infinity, -1])('prints the absent mark for %p', (input) => {
    expect(formatEnergy(input)).toBe(ABSENT);
  });
});

describe('formatCalories', () => {
  vaultIt('reads kcal, the unit the stat tile and the recording grid read', () => {
    expect(formatCalories(350)).toBe('350 kcal');
    expect(formatCalories(820.4)).toBe('820 kcal');
  });

  vaultIt('keeps a value of a thousand or more in kcal rather than a thousands suffix', () => {
    expect(formatCalories(1234)).toMatch(/^1[,.\u00a0\u202f]?234 kcal$/);
  });
});

describe('formatCalorieRate', () => {
  vaultIt('prints kcal per hour with the SI hour symbol', () => {
    expect(formatCalorieRate(546.2)).toBe('546 kcal/h');
  });

  it.each([NaN, Infinity, -1])('prints the absent mark for %p', (input) => {
    expect(formatCalorieRate(input)).toBe(ABSENT);
  });
});

describe('formatHrv', () => {
  vaultIt('prints milliseconds with a space', () => {
    expect(formatHrv(52.4)).toBe('52 ms');
  });

  it.each([NaN, Infinity, -1])('prints the absent mark for %p', (input) => {
    expect(formatHrv(input)).toBe(ABSENT);
  });
});

describe('formatCadence', () => {
  vaultIt('prints revolutions per minute with a space', () => {
    expect(formatCadence(89.6)).toBe('90 rpm');
  });

  it('prints steps a minute for a sport counted in steps', () => {
    expect(formatCadence(170, 'spm')).toBe('170 spm');
  });

  it.each([NaN, Infinity, -1])('prints the absent mark for %p', (input) => {
    expect(formatCadence(input)).toBe(ABSENT);
  });
});

describe('unit words follow the app language', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  afterEach(async () => {
    await changeLanguage('en-GB');
  });

  it('writes energy in the language its unit table gives', async () => {
    await changeLanguage('zh-Hans');
    expect(formatCalories(350)).toBe('350 千卡');
    expect(formatCalorieRate(546)).toBe('546 千卡/h');
  });

  it('writes heart rate in the language its unit table gives', async () => {
    await changeLanguage('es');
    expect(formatHeartRate(140)).toBe('140 lpm');
    expect(formatHeartRateRange(120, 140)).toBe('120-140 lpm');
    expect(formatHeartRateRange(180, null)).toBe('180+ lpm');
  });

  it('writes power in the language its unit table gives', async () => {
    await changeLanguage('zh-Hans');
    expect(formatPower(250)).toBe('250 瓦');
    expect(formatPowerRange(200, 250)).toBe('200-250 瓦');
    expect(formatPowerRange(300, null)).toBe('300+ 瓦');
  });

  it('keeps the English symbols under English', () => {
    expect(formatHeartRate(140)).toBe('140 bpm');
    expect(formatPower(250)).toBe('250 W');
    expect(formatCalories(350)).toBe('350 kcal');
  });
});

describe('the caller passes the unit system', () => {
  it('prints each distance, elevation and temperature in the system given', () => {
    expect(formatDistance(1500, true)).toBe('1.5 km');
    expect(formatDistance(1500, false)).toBe('0.9 mi');
    expect(formatElevation(100, true)).toBe('100 m');
    expect(formatElevation(100, false)).toBe('328 ft');
    expect(formatTemperature(20, true)).toBe('20°C');
    expect(formatTemperature(20, false)).toBe('68°F');
  });

  it('does not compile a call that leaves the unit system to a metric default', () => {
    // @ts-expect-error the unit system has no default: an imperial athlete would read metric
    const distanceWithoutSystem = () => formatDistance(1500);
    // @ts-expect-error the unit system has no default: an imperial athlete would read metric
    const elevationWithoutSystem = () => formatElevation(100);
    // @ts-expect-error the unit system has no default: an imperial athlete would read metric
    const temperatureWithoutSystem = () => formatTemperature(20);
    expect([distanceWithoutSystem, elevationWithoutSystem, temperatureWithoutSystem]).toHaveLength(
      3
    );
  });
});
