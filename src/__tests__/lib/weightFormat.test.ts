import {
  formatWeight,
  formatWeightRounded,
  formatWeightCompact,
  toDisplayWeight,
} from '@/shared/format/weight';

describe('body weight formatting', () => {
  it('prints metric weights with kg', () => {
    expect(formatWeight(72.5, true)).toBe('72.5 kg');
    expect(formatWeight(72, true)).toBe('72 kg');
    expect(formatWeightRounded(72.5, true)).toBe('73 kg');
    expect(formatWeightCompact(70.44, true)).toBe('70.4kg');
  });

  it('converts to pounds with one label for an imperial athlete', () => {
    expect(formatWeight(72.5, false)).toBe('159.8 lbs');
    expect(formatWeightRounded(72.5, false)).toBe('160 lbs');
    expect(formatWeightCompact(72.5, false)).toBe('159.8lbs');
    expect(toDisplayWeight(100, false)).toBeCloseTo(220.462);
  });
});
