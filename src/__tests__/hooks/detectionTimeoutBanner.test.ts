/**
 * Scenario: a first sync on a large library whose detection takes longer than
 * the follow's 420 s budget. `followDetection` settles `'timeout'`, which fell
 * through the same path as `'complete'`: the banner said the activities were
 * synced, and the sections changed under the athlete a minute later with
 * nothing on screen to say they would.
 *
 * Expected behaviour: a timeout says the analysis is still running. The Rust
 * run is not cancelled by the follow ending, so the sync is settled and the
 * detection is not.
 */
import { renderHook } from '@testing-library/react-native';

import type { SyncProgress } from '@/features/routes/hooks/useRouteSyncProgress';
import { useGpsDataFetcher } from '@/features/routes/hooks/useGpsDataFetcher';

// The banner is asserted by the key it renders: which string the sync ends on
// is the behaviour, and the translations are covered by the i18n suite.
jest.mock('@/i18n', () => ({
  i18n: { t: (key: string, vars?: Record<string, unknown>) => `${key}:${vars?.count ?? ''}` },
}));

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    engine: {
      ready: true,
      pollSectionDetection: () => 'running',
      triggerRefresh: jest.fn(),
      getSectionDetectionProgress: () => null,
      setActivityMetrics: jest.fn(),
      setTimeStreams: jest.fn(),
      addActivities: jest.fn(),
      getStats: () => ({ sectionsDirty: true }),
    },
  })
);

// Read through the mocked module, because a const in this file is not yet
// initialised when the factory above runs.
jest.mock('@/shared/native/engine', () => ({
  getNativeModule: () => ({ engine: jest.requireMock('veloqrs').engine }),
  getEngine: () => jest.requireMock('veloqrs').engine,
}));

const mockOutcome = { value: 'timeout' as 'complete' | 'timeout' | 'error' };
jest.mock('@/features/routes/lib/detectionRun', () => ({
  ...jest.requireActual('@/features/routes/lib/detectionRun'),
  followDetection: jest.fn(() => ({
    settled: Promise.resolve(mockOutcome.value),
    cancel: jest.fn(),
  })),
}));

jest.mock('@/features/routes/lib/gpsFetchRetry', () => ({
  fetchWithRetry: jest.fn(async () => ({
    syncedIds: ['a1', 'a2'],
    failedIds: [],
    recoveredIds: [],
    successCount: 2,
    total: 2,
    attempts: 1,
  })),
}));

jest.mock('@/features/routes/lib/gpsDownloadPoll', () => ({
  abandonDownload: jest.fn(),
  pollDownloadProgress: jest.fn(async () => 'settled'),
  runProgressReader: jest.fn(() => () => undefined),
}));

jest.mock('@/features/routes/lib/tilePass', () => ({
  waitForTilePass: jest.fn(async () => undefined),
  awaitTilePass: jest.fn(async () => undefined),
}));

const activity = (id: string) =>
  ({ id, type: 'Ride', start_date_local: '2026-01-01T08:00:00' }) as never;

async function sync() {
  const written: SyncProgress[] = [];
  const { result } = renderHook(() => useGpsDataFetcher());

  const answer = await result.current.fetchApiGps([activity('a1'), activity('a2')], {
    isMountedRef: { current: true },
    abortSignal: new AbortController().signal,
    updateProgress: (next) => {
      written.push(typeof next === 'function' ? next(written[written.length - 1]) : next);
    },
  });

  return { written, answer, last: written[written.length - 1] };
}

beforeEach(() => jest.clearAllMocks());

describe('a detection the follow gave up on', () => {
  beforeEach(() => {
    mockOutcome.value = 'timeout';
  });

  it('does not say the sync is done, it says the analysis is still running', async () => {
    const { last, answer } = await sync();

    expect(last.message).toBe('cache.syncedStillAnalysing:2');
    expect(answer.message).toBe(last.message);
  });

  it('still settles the sync, because the activities did land', async () => {
    const { last, answer } = await sync();

    expect(last.status).toBe('complete');
    expect(answer.syncedIds).toEqual(['a1', 'a2']);
  });
});

describe('a detection that finished inside the budget', () => {
  beforeEach(() => {
    mockOutcome.value = 'complete';
  });

  it('says what it always said', async () => {
    const { last } = await sync();

    expect(last.message).toBe('cache.syncedActivities:2');
  });
});
