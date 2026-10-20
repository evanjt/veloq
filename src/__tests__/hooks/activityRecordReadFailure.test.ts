/**
 * Scenario: an open activity's stored record is read again, after a sync or a
 * cache drop, while the database is briefly locked and the engine's read fails.
 *
 * Expected behaviour: the failure is a failed read, which the app's query client
 * reads again, so the activity comes back on screen. It never becomes "nothing
 * stored", which sends the detail screen to wait for a download nobody started.
 */

import { act, renderHook } from '@testing-library/react-native';
import { QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

import { useActivity } from '@/features/activity/hooks/useActivities';
import { getEngine } from '@/shared/native/engine';
import { queryClient } from '@/shared/query/QueryProvider';
import { queryKeys } from '@/shared/query/queryKeys';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

const stored = { id: 'ride-7', name: 'Harbour loop', isDetail: true };

const engine = {
  getActivityRecord: jest.fn(),
  syncActivityDetail: jest.fn(),
  subscribe: jest.fn(() => () => {}),
};

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(QueryClientProvider, { client: queryClient }, children);
}

const lockedRead = () => {
  throw new Error('database is locked');
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  (getEngine as jest.Mock).mockReturnValue(engine);
});

afterEach(() => {
  queryClient.clear();
  jest.useRealTimers();
});

describe('a stored activity whose read fails', () => {
  it('reads it again and shows it rather than waiting for a download', async () => {
    engine.getActivityRecord.mockImplementationOnce(lockedRead).mockReturnValue(stored);

    const view = await renderHook(() => useActivity('ride-7'), { wrapper });
    await act(async () => {
      await jest.runAllTimersAsync();
    });

    expect(view.result.current.data).toEqual(stored);
    expect(view.result.current.error).toBeNull();
    expect(engine.syncActivityDetail).not.toHaveBeenCalled();
  });

  it('comes back when a re-read of an open activity fails once', async () => {
    engine.getActivityRecord.mockReturnValue(stored);
    const view = await renderHook(() => useActivity('ride-7'), { wrapper });
    await act(async () => {
      await jest.runAllTimersAsync();
    });
    expect(view.result.current.data).toEqual(stored);

    engine.getActivityRecord.mockImplementationOnce(lockedRead);
    await act(async () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.activities.detail('ride-7') });
      await jest.runAllTimersAsync();
    });

    expect(view.result.current.data).toEqual(stored);
    expect(view.result.current.error).toBeNull();
    expect(engine.getActivityRecord).toHaveBeenCalledTimes(3);
    expect(engine.syncActivityDetail).not.toHaveBeenCalled();
  });

  it('says the read failed, not that it is downloading, when it keeps failing', async () => {
    engine.getActivityRecord.mockImplementation(lockedRead);

    const view = await renderHook(() => useActivity('ride-7'), { wrapper });
    await act(async () => {
      await jest.runAllTimersAsync();
    });

    expect(view.result.current.error).not.toBeNull();
    expect(view.result.current.data).toBeUndefined();
    expect(view.result.current.bodyStatus).toBe('idle');
    expect(engine.syncActivityDetail).not.toHaveBeenCalled();
  });
});
