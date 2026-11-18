/**
 * Scenario: an axis tick or readout for a count, a load or a duration in hours
 * is written by one formatter in the page's number locale.
 *
 * Expected behaviour: a whole value carries no trailing zero decimal, a
 * fractional one keeps one decimal, and the decimal mark follows the locale.
 */

import { plainNumber, setNumberLocale, signedDuration } from '../../../web/connect/format';
import { clock } from '../../../web/connect/pages/FitnessPane';

describe('plainNumber', () => {
  afterEach(() => setNumberLocale('en-GB'));

  it('drops the decimal of a whole value and keeps one for a fraction', () => {
    expect(plainNumber(150)).toBe('150');
    expect(plainNumber(0)).toBe('0');
    expect(plainNumber(12.34)).toBe('12.3');
    expect(plainNumber(-0.04)).toBe('0');
  });

  it('writes the decimal mark of the page locale', () => {
    setNumberLocale('de-CH');
    expect(plainNumber(2.5)).toBe('2.5');
    setNumberLocale('fr-FR');
    expect(plainNumber(2.5)).toBe('2,5');
  });
});

describe('signedDuration', () => {
  afterEach(() => setNumberLocale('en-GB'));

  it('writes seconds, minutes and hours of a gap with its sign', () => {
    expect(signedDuration(0)).toBe('0 s');
    expect(signedDuration(4.26)).toBe('+4.3 s');
    expect(signedDuration(-12)).toBe('−12 s');
    expect(signedDuration(75)).toBe('+1:15');
    expect(signedDuration(-600)).toBe('−10:00');
    expect(signedDuration(10_000)).toBe('+2 h 47 min');
  });

  it('carries a rounded second into the minute rather than writing 60', () => {
    expect(signedDuration(59.96)).toBe('+1:00');
    expect(signedDuration(3599.6)).toBe('+1 h 00 min');
  });

  it('writes the decimal mark of the page locale', () => {
    setNumberLocale('fr-FR');
    expect(signedDuration(2.5)).toBe('+2,5 s');
  });
});

describe('the fitness curve axis duration', () => {
  it('names the unit of every part: seconds, minutes and seconds, then hours and minutes', () => {
    expect(clock(45)).toBe('45 s');
    expect(clock(75)).toBe('1:15');
    expect(clock(3600)).toBe('1 h 00 min');
    expect(clock(4980)).toBe('1 h 23 min');
  });
});
