/**
 * Scenario: the engine stamps each calendar event's `start_date_local` as wall
 * clock read as UTC, and the read built its window from the true instant of
 * local midnight, so west of UTC today's midnight workout fell before the
 * window and east of it last evening's events fell inside.
 *
 * Expected behaviour: an event is returned for its own day and not for the day
 * either side, whatever the device timezone.
 */

import { readCalendarEvents } from '@/features/home/lib/calendarEvents';
import { getEngine } from '@/shared/native/engine';
import { startDateLocalToEpochSeconds } from '@/shared/time/startDate';
import { atUtcOffset } from '../__shared__/fixedOffsetDate';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

const EVENTS = [
  '2026-09-22T23:00:00',
  '2026-09-23T00:00:00',
  '2026-09-23T15:00:00',
  '2026-09-23T23:00:00',
  '2026-09-24T00:00:00',
].map((start) => ({ id: start, start_date_local: start }));

/** The engine's `WHERE date >= ? AND date <= ?` over wall-clock stamps. */
const engine = {
  getCalendarEventBodies: (from: number, to: number) =>
    EVENTS.filter((event) => {
      const stamp = startDateLocalToEpochSeconds(event.start_date_local)!;
      return stamp >= from && stamp <= to;
    }).map((event) => JSON.stringify(event)),
};

beforeEach(() => {
  mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
});

describe.each([
  ['UTC-7', -7],
  ['UTC+10', 10],
  ['UTC', 0],
])('at %s', (_zone, offset) => {
  it("returns today's events, from midnight to the last hour, and no others", () => {
    const ids = atUtcOffset(offset, () => readCalendarEvents('2026-09-23', '2026-09-23')).map(
      (e) => e.id
    );

    expect(ids).toEqual(['2026-09-23T00:00:00', '2026-09-23T15:00:00', '2026-09-23T23:00:00']);
  });

  it('spans a multi-day window inclusive of both ends', () => {
    const ids = atUtcOffset(offset, () => readCalendarEvents('2026-09-22', '2026-09-24')).map(
      (e) => e.id
    );

    expect(ids).toEqual(EVENTS.map((e) => e.id));
  });
});
