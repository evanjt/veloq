/**
 * Energy expenditure from mean heart rate, weight and age, by the sex-specific
 * regression of Keytel et al., Journal of Sports Sciences, 2005. A profile
 * with no sex takes the male form, as every other sex-keyed read here does.
 * Returns kilocalories per minute, floored at zero.
 */
export function heartRateKcalPerMinute(input: {
  avgHeartrate: number;
  weightKg: number;
  ageYears: number;
  sex: string | null | undefined;
}): number {
  const { avgHeartrate, weightKg, ageYears, sex } = input;
  const kilojoulesPerMin =
    sex === 'F'
      ? -20.4022 + 0.4472 * avgHeartrate - 0.1263 * weightKg + 0.074 * ageYears
      : -55.0969 + 0.6309 * avgHeartrate + 0.1988 * weightKg + 0.2017 * ageYears;
  return Math.max(0, kilojoulesPerMin / 4.184);
}
