/**
 * Scenario: an athlete whose app was killed mid-detection, or whose engine came
 * back dirty after a quarantine, opens the Routes tab with no network. The sync
 * returned on `!online` above work that needs no network at all, so the section
 * chips and the PR indicators could not come back until the network did.
 *
 * Expected behaviour: only the three network halves are gated on the network.
 * The local recovery runs either way.
 */
import { routeSyncPlan } from '@/features/routes/lib/routeSyncPlan';

describe('online, with work to fetch', () => {
  const plan = routeSyncPlan({ online: true, isDemo: false, newGpsCount: 12 });

  it('fetches and leaves the recovery to the pass that has nothing to fetch', () => {
    expect(plan).toEqual({
      fetchGps: true,
      fetchStrength: true,
      backfillStreams: true,
      recoverDetection: false,
    });
  });
});

describe('offline', () => {
  it('runs the local recovery and asks the network for nothing', () => {
    expect(routeSyncPlan({ online: false, isDemo: false, newGpsCount: 12 })).toEqual({
      fetchGps: false,
      fetchStrength: false,
      backfillStreams: false,
      recoverDetection: true,
    });
  });

  it('recovers the same way when there was nothing new to fetch anyway', () => {
    expect(routeSyncPlan({ online: false, isDemo: false, newGpsCount: 0 })).toEqual({
      fetchGps: false,
      fetchStrength: false,
      backfillStreams: false,
      recoverDetection: true,
    });
  });
});

describe('demo mode', () => {
  it('fetches its fixtures offline and asks intervals.icu for nothing', () => {
    expect(routeSyncPlan({ online: false, isDemo: true, newGpsCount: 3 })).toEqual({
      fetchGps: true,
      fetchStrength: false,
      backfillStreams: false,
      recoverDetection: false,
    });
  });

  it('recovers when the fixtures are already in the engine', () => {
    expect(routeSyncPlan({ online: true, isDemo: true, newGpsCount: 0 })).toEqual({
      fetchGps: false,
      fetchStrength: false,
      backfillStreams: false,
      recoverDetection: true,
    });
  });
});

describe('online with nothing new', () => {
  it('recovers, backfills and still asks for the strength files', () => {
    expect(routeSyncPlan({ online: true, isDemo: false, newGpsCount: 0 })).toEqual({
      fetchGps: false,
      fetchStrength: true,
      backfillStreams: true,
      recoverDetection: true,
    });
  });
});

describe('the hook no longer returns above the local half', () => {
  it('has no early return on the offline branch', () => {
    const source = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'features/routes/hooks/useRouteDataSync.ts'),
      'utf8'
    );
    expect(source).toMatch(/routeSyncPlan\(/);
    expect(source).not.toMatch(/log\.log\('\[RouteDataSync\] Blocked: offline'\)/);
  });
});
