/**
 * Scenario: the iOS notification service extension is a second process against
 * the same App Group database. It stores and indexes a ride while the app sits
 * suspended with its engine open, so the foreground tiers predate the rows.
 *
 * Expected behaviour: coming back to the app takes those writes and re-reads
 * the screens that show them, and a resume that missed no push costs one
 * `SELECT` and invalidates nothing. The engine answers which of the two it was,
 * so this side only has to ask on the right event and act on the answer.
 */

import React from 'react';
import { AppState } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, act } from '@testing-library/react-native';

import { usePushedWritesOnForeground } from '@/shared/native/usePushedWritesOnForeground';
import { queryKeys } from '@/shared/query/queryKeys';

const mockTakeExternalWrites = jest.fn();
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({ takeExternalWrites: () => mockTakeExternalWrites() }),
}));

let appStateListeners: ((s: string) => void)[] = [];
let queryClient: QueryClient;
let invalidate: jest.SpyInstance;

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

/** Background then active, which is the only pair that counts as a return. */
function leaveAndComeBack() {
  act(() => {
    appStateListeners.forEach((l) => l('background'));
    appStateListeners.forEach((l) => l('active'));
  });
}

beforeEach(() => {
  appStateListeners = [];
  mockTakeExternalWrites.mockReset();
  queryClient = new QueryClient();
  invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  jest.spyOn(AppState, 'addEventListener').mockImplementation(((
    _event: string,
    handler: (s: string) => void
  ) => {
    appStateListeners.push(handler);
    return { remove: jest.fn() };
  }) as unknown as typeof AppState.addEventListener);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('what the app takes on the way back', () => {
  it('re-reads the screens a push can have changed', () => {
    mockTakeExternalWrites.mockReturnValue(true);
    renderHook(() => usePushedWritesOnForeground(), { wrapper });

    leaveAndComeBack();

    const keys = invalidate.mock.calls.map((call) => JSON.stringify(call[0]));
    expect(keys).toContain(JSON.stringify({ queryKey: queryKeys.activities.all }));
    expect(keys).toContain(JSON.stringify({ queryKey: queryKeys.sections.all }));
  });

  it('invalidates nothing when no push landed while it was away', () => {
    mockTakeExternalWrites.mockReturnValue(false);
    renderHook(() => usePushedWritesOnForeground(), { wrapper });

    leaveAndComeBack();

    expect(mockTakeExternalWrites).toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('does not ask on the inactive flicker of a notification shade', () => {
    mockTakeExternalWrites.mockReturnValue(true);
    renderHook(() => usePushedWritesOnForeground(), { wrapper });

    act(() => {
      appStateListeners.forEach((l) => l('inactive'));
      appStateListeners.forEach((l) => l('active'));
    });

    expect(mockTakeExternalWrites).not.toHaveBeenCalled();
  });
});
