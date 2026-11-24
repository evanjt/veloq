import { heartRateKcalPerMinute } from '@/features/recording/lib/heartRateCalories';

describe('heartRateKcalPerMinute', () => {
  const input = { avgHeartrate: 140, weightKg: 60, ageYears: 35 };

  it('uses the male coefficients for M', () => {
    const expected = (-55.0969 + 0.6309 * 140 + 0.1988 * 60 + 0.2017 * 35) / 4.184;
    expect(heartRateKcalPerMinute({ ...input, sex: 'M' })).toBeCloseTo(expected, 10);
  });

  it('uses the female coefficients for F, about 534 kcal over an hour', () => {
    const expected = (-20.4022 + 0.4472 * 140 - 0.1263 * 60 + 0.074 * 35) / 4.184;
    const perMin = heartRateKcalPerMinute({ ...input, sex: 'F' });
    expect(perMin).toBeCloseTo(expected, 10);
    expect(Math.round(perMin * 60)).toBe(534);
  });

  it('keeps the male form when the profile carries no sex', () => {
    expect(heartRateKcalPerMinute({ ...input, sex: undefined })).toBe(
      heartRateKcalPerMinute({ ...input, sex: 'M' })
    );
  });

  it('never goes below zero at a very low pulse', () => {
    expect(heartRateKcalPerMinute({ avgHeartrate: 30, weightKg: 50, ageYears: 20, sex: 'F' })).toBe(
      0
    );
  });
});
