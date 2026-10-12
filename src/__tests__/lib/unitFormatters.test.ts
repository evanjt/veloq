/**
 * Scenario: power, energy, heart rate and HRV were written by hand at each
 * site, so one statistic read '812W' on one screen and '812 W' on the next,
 * W' read '12.8kJ', and energy was 'cal' on a card and 'kcal' on the tile.
 *
 * Expected behaviour: each quantity has one formatter, the SI symbol separated
 * from the value by a space, and energy in food calories reads kcal.
 */

import {
  formatCadence,
  formatCalorieRate,
  formatCalories,
  formatEnergy,
  formatHeartRateRange,
  formatHrv,
  formatPowerRange,
} from '@/shared/format/format';
import { ABSENT } from '@/shared/format/absent';

describe('formatPowerRange', () => {
  it('prints a closed zone with one symbol after the range', () => {
    expect(formatPowerRange(0, 150)).toBe('0-150 W');
    expect(formatPowerRange(200.4, 249.6)).toBe('200-250 W');
  });

  it('prints the open top zone as its lower bound and up', () => {
    expect(formatPowerRange(300, null)).toBe('300+ W');
  });

  it('never leaks an invalid bound', () => {
    expect(formatPowerRange(NaN, 150)).toBe('0-150 W');
    expect(formatPowerRange(-5, Infinity)).toBe('0+ W');
  });
});

describe('formatHeartRateRange', () => {
  it('prints a zone with one symbol after the range', () => {
    expect(formatHeartRateRange(120, 140)).toBe('120-140 bpm');
  });

  it('never leaks an invalid bound', () => {
    expect(formatHeartRateRange(NaN, 140)).toBe('0-140 bpm');
  });

  it('prints an open top zone as its lower bound and a plus', () => {
    expect(formatHeartRateRange(180, null)).toBe('180+ bpm');
  });
});

describe('formatEnergy', () => {
  it('prints joules as kilojoules with a space', () => {
    expect(formatEnergy(12800)).toBe('12.8 kJ');
    expect(formatEnergy(19655)).toBe('19.7 kJ');
  });

  it('leaves a whole number whole', () => {
    expect(formatEnergy(11000)).toBe('11 kJ');
    expect(formatEnergy(0)).toBe('0 kJ');
  });

  it.each([NaN, Infinity, -1])('prints the absent mark for %p', (input) => {
    expect(formatEnergy(input)).toBe(ABSENT);
  });
});

describe('formatCalories', () => {
  it('reads kcal, the unit the stat tile and the recording grid read', () => {
    expect(formatCalories(350)).toBe('350 kcal');
    expect(formatCalories(820.4)).toBe('820 kcal');
  });

  it('keeps a value of a thousand or more in kcal rather than a thousands suffix', () => {
    expect(formatCalories(1234)).toMatch(/^1[,.\u00a0\u202f]?234 kcal$/);
  });
});

describe('formatCalorieRate', () => {
  it('prints kcal per hour with the SI hour symbol', () => {
    expect(formatCalorieRate(546.2)).toBe('546 kcal/h');
  });

  it.each([NaN, Infinity, -1])('prints the absent mark for %p', (input) => {
    expect(formatCalorieRate(input)).toBe(ABSENT);
  });
});

describe('formatHrv', () => {
  it('prints milliseconds with a space', () => {
    expect(formatHrv(52.4)).toBe('52 ms');
  });

  it.each([NaN, Infinity, -1])('prints the absent mark for %p', (input) => {
    expect(formatHrv(input)).toBe(ABSENT);
  });
});

describe('formatCadence', () => {
  it('prints revolutions per minute with a space', () => {
    expect(formatCadence(89.6)).toBe('90 rpm');
  });

  it.each([NaN, Infinity, -1])('prints the absent mark for %p', (input) => {
    expect(formatCadence(input)).toBe(ABSENT);
  });
});
