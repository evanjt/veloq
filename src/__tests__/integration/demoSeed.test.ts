/**
 * Scenario: demo mode must read the same SQLite tables as live mode, so
 * entering it writes the bundled fixtures through the engine writers a live
 * sync uses. A missing table here shows as an empty screen in demo only.
 */

import { demoLibrary, seedDemoEngine } from '@/shared/app/seedDemoEngine';
import { getEngine } from '@/shared/native/engine';
import { PACE_SNAPSHOT_WINDOW_DAYS, TIME_RANGES } from '@/shared/app/constants';
import { timeRangeToDays } from '@/features/wellness';

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const engine = {
  setAthleteProfile: jest.fn(),
  setSportSettings: jest.fn(),
  upsertWellness: jest.fn(),
  upsertActivityBodies: jest.fn(),
  setSetting: jest.fn(),
  setIntervalBody: jest.fn(),
  setCurveBody: jest.fn(),
  replaceCalendarEvents: jest.fn(),
  savePaceSnapshot: jest.fn(),
  triggerRefresh: jest.fn(),
  announceBodyStored: jest.fn(),
};

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

describe('seedDemoEngine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEngine.mockReturnValue(engine as unknown as ReturnType<typeof getEngine>);
  });

  it('stores the athlete profile as a raw body', () => {
    seedDemoEngine();

    expect(engine.setAthleteProfile).toHaveBeenCalledTimes(1);
    const profile = JSON.parse(engine.setAthleteProfile.mock.calls[0][0]);
    expect(profile.id).toBeDefined();
  });

  it('stores sport settings as a raw body', () => {
    seedDemoEngine();

    const settings = JSON.parse(engine.setSportSettings.mock.calls[0][0]);
    expect(Array.isArray(settings)).toBe(true);
    expect(settings.length).toBeGreaterThan(0);
  });

  /**
   * The engine reads sport settings in the shape the athlete endpoint sends:
   * `lthr`, and zones as plain numbers. Demo settings in any other shape read
   * as unset, so the running card had no threshold heart rate in demo.
   */
  it('stores sport settings in the shape the athlete endpoint sends', () => {
    const entries = JSON.parse(demoLibrary().sportSettingsJson) as Record<string, unknown>[];
    const covering = (sport: string) =>
      entries.find((entry) => (entry.types as string[]).includes(sport));
    const ascendingNumbers = (value: unknown) =>
      Array.isArray(value) &&
      value.length > 0 &&
      value.every((n, i) => typeof n === 'number' && (i === 0 || n > value[i - 1]));

    const run = covering('Run');
    expect(typeof run?.lthr).toBe('number');
    expect(ascendingNumbers(run?.hr_zones)).toBe(true);
    expect(run?.threshold_pace).toBeLessThan(10);

    const ride = covering('Ride');
    expect(typeof ride?.ftp).toBe('number');
    expect(typeof ride?.lthr).toBe('number');
    expect(ascendingNumbers(ride?.hr_zones)).toBe(true);
    expect(ascendingNumbers(ride?.power_zones)).toBe(true);
  });

  it('upserts wellness rows keyed by date', () => {
    seedDemoEngine();

    const rows = engine.upsertWellness.mock.calls[0][0];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  /**
   * Wellness no longer follows the `activities` channel, since Rust announces
   * it by kind now. A demo seed that only triggers `activities` would leave the
   * wellness screens on whatever they read before the fixtures landed, which is
   * nothing.
   */
  it('announces the wellness it seeded, the way a live sync does', () => {
    seedDemoEngine();

    expect(engine.announceBodyStored).toHaveBeenCalledWith('wellness');
  });

  it('lets the engine derive metrics from every seeded body', () => {
    seedDemoEngine();

    expect(engine.upsertActivityBodies).toHaveBeenCalledTimes(1);
  });

  it('passes ride power to the engine in its stored body', () => {
    seedDemoEngine();

    const bodies = engine.upsertActivityBodies.mock.calls[0][0];
    const body = bodies.find((row: { activityId: string }) => row.activityId === 'demo-test-0');
    expect(JSON.parse(body.raw).icu_average_watts).toBe(195);
  });

  it('stores an activity body for every fixture activity', () => {
    seedDemoEngine();

    const rows = engine.upsertActivityBodies.mock.calls[0][0];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toHaveProperty('activityId');
    expect(typeof rows[0].date).toBe('number');
    expect(JSON.parse(rows[0].raw).id).toBe(rows[0].activityId);
  });

  it('records the oldest activity date the timeline slider reads', () => {
    seedDemoEngine();

    expect(engine.setSetting).toHaveBeenCalledWith(
      'oldest_activity_date',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}/)
    );
  });

  it('stores both curve kinds under the windows the stats screens ask for', () => {
    seedDemoEngine();

    const kinds = new Set(engine.setCurveBody.mock.calls.map((c: unknown[]) => c[0]));
    expect(kinds).toEqual(new Set(['power', 'pace']));
    const paceWindows = engine.setCurveBody.mock.calls
      .filter((c: unknown[]) => c[0] === 'pace')
      .map((c: unknown[]) => c[2]);
    expect(paceWindows).toContain(42);
  });

  /**
   * The Fitness tab asks for a curve under whichever period its picker shows,
   * six months by default. A period the seed skips reads as never downloaded,
   * with a retry that has no credential to fetch with.
   */
  it.each(TIME_RANGES.map((range) => [range.id, timeRangeToDays(range.id)]))(
    'stores every curve the Fitness tab draws for the %s period',
    (_period, days) => {
      seedDemoEngine();

      const stored = engine.setCurveBody.mock.calls.map(
        ([kind, sport, window, gap]: [string, string, number, boolean]) =>
          `${kind}:${sport}:${window}:${gap}`
      );
      expect(stored).toEqual(
        expect.arrayContaining([
          `power:Ride:${days}:false`,
          `pace:Run:${days}:false`,
          `pace:Run:${days}:true`,
          `pace:Swim:${days}:false`,
        ])
      );
    }
  );

  it('stores planned workouts so the record screen can show them', () => {
    seedDemoEngine();

    expect(engine.replaceCalendarEvents).toHaveBeenCalled();
    const [, , rows] = engine.replaceCalendarEvents.mock.calls[0];
    expect(Array.isArray(rows)).toBe(true);
  });

  it('passes the curve end date to the Rust snapshot writer', () => {
    seedDemoEngine();

    const call = engine.setCurveBody.mock.calls.find(
      ([kind, sport, days, gap]: [string, string, number, boolean]) =>
        kind === 'pace' && sport === 'Run' && days === PACE_SNAPSHOT_WINDOW_DAYS && !gap
    );
    expect(JSON.parse(call[4]).list[0].end_date_local).toBeDefined();
    expect(engine.savePaceSnapshot).not.toHaveBeenCalled();
  });

  it('wakes engine-derived readers once seeding is done', () => {
    seedDemoEngine();

    expect(engine.triggerRefresh).toHaveBeenCalledWith('activities');
  });

  it('rewrites the same rows when seeded twice', () => {
    seedDemoEngine();
    const first = engine.upsertWellness.mock.calls[0][0];
    seedDemoEngine();
    const second = engine.upsertWellness.mock.calls[1][0];

    expect(second).toEqual(first);
  });

  it('is a no-op before the engine exists', () => {
    mockGetEngine.mockReturnValue(null);

    expect(() => seedDemoEngine()).not.toThrow();
    expect(engine.setAthleteProfile).not.toHaveBeenCalled();
  });
});
