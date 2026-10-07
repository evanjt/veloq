/**
 * Scenario: strength period and trailing-week windows are built from the device
 * clock, then compared against `activity_metrics.date`, a wall clock stamped as
 * UTC (`exercise_sets_in_range` and its siblings). Expected behaviour: the bounds carry
 * the athlete's local calendar whatever the device offset, so an evening
 * session counts in the week it happened.
 */
import {
  getTimestampRange,
  getTrailingWeekRanges,
} from '@/features/strength/hooks/useStrengthScreenData';
import { buildInsightsParams } from '@/features/insights/lib/insightsParams';
import { trailingWeekRanges } from '@/shared/time/trailingWeeks';
import { atUtcOffset } from '../__shared__/fixedOffsetDate';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const withTz = <T>(offset: number, run: () => T): T => atUtcOffset(offset, run);

const iso = (ts: number) => new Date(ts * 1000).toISOString();

describe('strength window timebase', () => {
  it.each([10, -7, 0])('ends the period at local end-of-day at UTC offset %d', (tz) => {
    const { endTs } = withTz(tz, () => getTimestampRange('7d'));
    expect(iso(endTs)).toMatch(/T23:59:59\.000Z$/);
  });

  it.each([10, -7, 0])('starts the period at local midnight at UTC offset %d', (tz) => {
    const { startTs } = withTz(tz, () => getTimestampRange('7d'));
    expect(iso(startTs)).toMatch(/T00:00:00\.000Z$/);
  });

  it('spans exactly the requested days, today among them', () => {
    const { startTs, endTs } = withTz(10, () => getTimestampRange('7d'));
    expect(endTs - startTs).toBe(6 * 86400 + 86399);
  });

  it.each([10, -7])(
    'makes the 7d period the same days as the This wk bar at UTC offset %d',
    (tz) => {
      const [period, weeks] = withTz(tz, () => [getTimestampRange('7d'), getTrailingWeekRanges(4)]);
      const thisWeek = weeks[weeks.length - 1];
      expect({ startTs: period.startTs, endTs: period.endTs }).toEqual({
        startTs: thisWeek.startTs,
        endTs: thisWeek.endTs,
      });
    }
  );

  it('asks the insights for the same four weeks the tab draws', () => {
    // The reference is built under the same offset, or near midnight the
    // runner's own zone sits a calendar day away from it.
    const [params, weeks, reference] = withTz(10, () => [
      buildInsightsParams(),
      getTrailingWeekRanges(4),
      trailingWeekRanges(4),
    ]);
    expect(params.strengthWeeks).toEqual(reference);
    expect(weeks.map(({ startTs, endTs }) => ({ startTs, endTs }))).toEqual(reference);
  });

  it.each([10, -7])(
    'gives each trailing week a whole local day at both ends at UTC offset %d',
    (tz) => {
      const ranges = withTz(tz, () => getTrailingWeekRanges(4));
      expect(ranges).toHaveLength(4);
      for (const range of ranges) {
        expect(iso(range.startTs)).toMatch(/T00:00:00\.000Z$/);
        expect(iso(range.endTs)).toMatch(/T23:59:59\.000Z$/);
        expect(range.endTs - range.startTs).toBe(6 * 86400 + 86399);
      }
    }
  );

  it('leaves no gap and no overlap between consecutive weeks', () => {
    const ranges = withTz(10, () => getTrailingWeekRanges(4));
    for (let i = 1; i < ranges.length; i += 1) {
      expect(ranges[i].startTs - ranges[i - 1].endTs).toBe(1);
    }
  });
});
