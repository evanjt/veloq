/**
 * Scenario: demo mode must read the same SQLite tables as live mode, so
 * entering it writes the bundled fixtures through the engine writers a live
 * sync uses. A missing table here shows as an empty screen in demo only.
 */

import { seedDemoEngine } from '@/shared/app/seedDemoEngine';
import { applyDetectionStrictness, getRouteEngine } from '@/shared/native/routeEngine';

jest.mock('@/shared/native/routeEngine', () => ({
  getRouteEngine: jest.fn(),
  applyDetectionStrictness: jest.fn(),
}));

const engine = {
  setAthleteProfile: jest.fn(),
  setSportSettings: jest.fn(),
  upsertWellness: jest.fn(),
  setActivityMetrics: jest.fn(),
  upsertActivityBodies: jest.fn(),
  setSetting: jest.fn(),
  setIntervalBody: jest.fn(),
  setCurveBody: jest.fn(),
  replaceCalendarEvents: jest.fn(),
  savePaceSnapshot: jest.fn(),
  triggerRefresh: jest.fn(),
};

const mockGetRouteEngine = getRouteEngine as jest.MockedFunction<typeof getRouteEngine>;

describe('seedDemoEngine', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetRouteEngine.mockReturnValue(engine as unknown as ReturnType<typeof getRouteEngine>);
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

  it('upserts wellness rows keyed by date', () => {
    seedDemoEngine();

    const rows = engine.upsertWellness.mock.calls[0][0];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('upserts activity metrics for every fixture activity', () => {
    seedDemoEngine();

    const metrics = engine.setActivityMetrics.mock.calls[0][0];
    expect(metrics.length).toBeGreaterThan(0);
    expect(metrics[0]).toHaveProperty('activityId');
    expect(metrics[0]).toHaveProperty('sportType');
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

  it('stores planned workouts so the record screen can show them', () => {
    seedDemoEngine();

    expect(engine.replaceCalendarEvents).toHaveBeenCalled();
    const [, , rows] = engine.replaceCalendarEvents.mock.calls[0];
    expect(Array.isArray(rows)).toBe(true);
  });

  it('records a pace snapshot so trend tracking has a baseline', () => {
    seedDemoEngine();

    expect(engine.savePaceSnapshot).toHaveBeenCalledWith(
      'Run',
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
      expect.any(Number)
    );
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
    mockGetRouteEngine.mockReturnValue(null);

    expect(() => seedDemoEngine()).not.toThrow();
    expect(engine.setAthleteProfile).not.toHaveBeenCalled();
  });

  it('puts demo on the shipped detector, since every tier0 flow runs here', () => {
    mockGetRouteEngine.mockReturnValue(engine as never);

    seedDemoEngine();

    expect(applyDetectionStrictness).toHaveBeenCalledWith('default');
  });
});
