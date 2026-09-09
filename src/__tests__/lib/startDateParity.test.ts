/**
 * Scenario: `activity_metrics.date` is written by both TypeScript and Rust.
 * Expected behaviour: identical epoch seconds for the same `start_date_local`,
 * independent of the device timezone, since the source string carries no zone.
 * The same fixtures are asserted in `start_date_parity_tests` in objects/sync.rs.
 */
import { startDateLocalToEpochSeconds } from '@/shared/time/startDate';

const FIXTURES: [string, number][] = [
  ['2026-08-22T18:30:00', 1787423400],
  ['2026-01-01T00:00:00', 1767225600],
  ['2026-12-31T23:59:59', 1798761599],
  ['2026-06-15T12:00:00.000', 1781524800],
  ['2024-02-29T06:45:30', 1709189130],
];

describe('start_date_local to epoch seconds', () => {
  it.each(FIXTURES)('parses %s', (input, expected) => {
    expect(startDateLocalToEpochSeconds(input)).toBe(expected);
  });

  it('does not shift with the device timezone', () => {
    const original = process.env.TZ;
    const readings = ['UTC', 'Europe/Zurich', 'Pacific/Auckland', 'America/Los_Angeles'].map(
      (tz) => {
        process.env.TZ = tz;
        return startDateLocalToEpochSeconds('2026-08-22T18:30:00');
      }
    );
    process.env.TZ = original;
    expect(new Set(readings).size).toBe(1);
  });

  it('returns null for missing or unparseable input', () => {
    expect(startDateLocalToEpochSeconds(null)).toBeNull();
    expect(startDateLocalToEpochSeconds(undefined)).toBeNull();
    expect(startDateLocalToEpochSeconds('')).toBeNull();
    expect(startDateLocalToEpochSeconds('not a date')).toBeNull();
  });
});
