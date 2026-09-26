/**
 * Scenario: the GPS download's store thread dies mid-run. The poll sees the
 * download go inactive, the engine holds no result, and `fetchApiGps` returns
 * having stored nothing.
 *
 * Expected behaviour: the last status the run wrote is terminal. Leaving
 * `fetching` standing keeps the map banner, the settings range panel and the
 * routes list spinner up until the next sync replaces it.
 */
import { renderHook } from '@testing-library/react-native';

import type { SyncProgress } from '@/features/routes/hooks/useRouteSyncProgress';
import { useGpsDataFetcher } from '@/features/routes/hooks/useGpsDataFetcher';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getNativeModule: () => ({ engine: { pollSectionDetection: () => 'idle' } }),
  getEngine: () => null,
}));

// The run never reaches a pass: the retry wrapper answers null, which is what
// a dead store thread leaves behind.
jest.mock('@/features/routes/lib/gpsFetchRetry', () => ({
  fetchWithRetry: jest.fn(async () => null),
}));

jest.mock('@/features/routes/lib/gpsDownloadPoll', () => ({
  abandonDownload: jest.fn(),
  pollDownloadProgress: jest.fn(async () => 'settled'),
  runProgressReader: jest.fn(() => () => undefined),
}));

const activity = (id: string) =>
  ({
    id,
    type: 'Ride',
    start_date_local: '2026-01-01T08:00:00',
  }) as never;

async function runToExhaustion() {
  const written: SyncProgress[] = [];
  const { result } = renderHook(() => useGpsDataFetcher());

  const outcome = await result.current.fetchApiGps([activity('a1'), activity('a2')], {
    isMountedRef: { current: true },
    abortSignal: new AbortController().signal,
    updateProgress: (next) => {
      written.push(typeof next === 'function' ? next(written[written.length - 1]) : next);
    },
  });

  return { written, outcome };
}

describe('a GPS download whose worker dies', () => {
  it('does not leave a running status standing', async () => {
    const { written } = await runToExhaustion();

    expect(written.length).toBeGreaterThan(0);
    expect(written[written.length - 1].status).not.toBe('fetching');
  });

  it('ends on an error, because nothing was stored and nobody cancelled', async () => {
    const { written } = await runToExhaustion();

    expect(written[written.length - 1].status).toBe('error');
  });

  it('says why, so the ending is readable in the log', async () => {
    const { outcome } = await runToExhaustion();

    expect(outcome.syncedIds).toEqual([]);
    expect(outcome.message).not.toBe('');
  });
});
