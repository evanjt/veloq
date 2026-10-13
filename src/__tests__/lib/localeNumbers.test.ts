/**
 * Scenario: dates follow the app language, and numbers printed a period
 * decimal and no grouping whatever it was, so a German reader saw '12.5 km'
 * beside '0,82' on one screen. Signed changes printed '-0.0' for a value that
 * rounds to nothing.
 *
 * Expected behaviour: every shared number formatter writes the app locale's
 * decimal and group separators, and a signed value that rounds to zero carries
 * no sign.
 */

import {
  formatCalories,
  formatDecimal,
  formatDistance,
  formatElevation,
  formatEnergy,
  formatFileSize,
  formatPercent,
  formatSigned,
  formatSignedPercent,
  formatSpeed,
  formatWeight,
  formatWeightCompact,
  formatWeightRounded,
} from '@/shared/format';

let mockLocale = 'en-GB';
jest.mock('@/i18n', () => ({
  ...jest.requireActual('@/i18n'),
  getCurrentLanguage: () => mockLocale,
}));

afterEach(() => {
  mockLocale = 'en-GB';
});

describe('under de-DE', () => {
  beforeEach(() => {
    mockLocale = 'de-DE';
  });

  it('writes a comma decimal in distances, speeds and weights', () => {
    expect(formatDistance(12500, true)).toBe('12,5 km');
    expect(formatSpeed(10, true)).toBe('36,0 km/h');
    expect(formatWeight(72.5, true)).toBe('72,5 kg');
    expect(formatWeightCompact(72.54, true)).toBe('72,5kg');
    expect(formatEnergy(12800)).toBe('12,8 kJ');
    expect(formatFileSize(1_500_000)).toBe('1,5 MB');
  });

  it('groups thousands with a period', () => {
    expect(formatElevation(1234)).toBe('1.234 m');
    expect(formatCalories(12345)).toBe('12.345 kcal');
    expect(formatWeightRounded(1234, true)).toBe('1.234 kg');
  });

  it('writes a decimal and a percentage the locale way', () => {
    expect(formatDecimal(0.82, 2)).toBe('0,82');
    expect(formatPercent(12.5, 1)).toBe('12,5\u00a0%');
    expect(formatSigned(-1.25, 1)).toBe('-1,3');
    expect(formatSignedPercent(0.14)).toBe('+14\u00a0%');
  });
});

describe('under en-GB', () => {
  it('keeps the period decimal and groups with a comma', () => {
    expect(formatDistance(12500, true)).toBe('12.5 km');
    expect(formatElevation(1234)).toBe('1,234 m');
    expect(formatWeight(72, true)).toBe('72 kg');
    expect(formatPercent(12.5, 1)).toBe('12.5%');
  });
});

describe('formatSigned', () => {
  it.each([
    [-0.03, 1, '0.0'],
    [0.04, 1, '0.0'],
    [-0, 1, '0.0'],
    [0, 0, '0'],
    [-0.4, 0, '0'],
    [2, 1, '+2.0'],
    [-2, 1, '-2.0'],
    [1234.5, 1, '+1,234.5'],
  ])('%p to %p digits reads %s', (value, digits, text) => {
    expect(formatSigned(value, digits)).toBe(text);
  });

  it('writes one minus glyph, the one a negative decimal carries', () => {
    expect(formatSigned(-2, 1)).toBe(formatDecimal(-2, 1));
  });

  it('prints the absent mark for a value that is not a number', () => {
    expect(formatSigned(Number.NaN, 1)).toBe('--');
    expect(formatDecimal(Number.POSITIVE_INFINITY, 1)).toBe('--');
  });
});
