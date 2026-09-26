/**
 * Scenario: the settings screen watches eight preference stores, so toggling
 * any of them re-renders it.
 *
 * Expected behaviour: the last backup time is read when the screen appears,
 * not when it paints. The read is an engine call holding the write lock on the
 * JavaScript thread, and a re-render is not new information.
 */

import { renderHook, act } from '@testing-library/react-native';
import { useEffect } from 'react';
import { useFocusEffect } from 'expo-router';

import { useLastBackupTimestamp } from '@/features/settings/hooks/useLastBackupTimestamp';
import { getLastBackupTimestamp } from '@/features/settings/lib/autobackup';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

let focusCallback: (() => void) | null = null;
jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
}));

jest.mock('@/features/settings/lib/autobackup', () => ({
  getLastBackupTimestamp: jest.fn(() => 1_700_000_000_000),
}));

const mockRead = getLastBackupTimestamp as jest.MockedFunction<typeof getLastBackupTimestamp>;

beforeEach(() => {
  jest.clearAllMocks();
  focusCallback = null;
  // Stand in for the navigator. The real one runs the callback in an effect
  // after the focus, so running it during render would be a different hook.
  (useFocusEffect as jest.Mock).mockImplementation((cb: () => void) => {
    focusCallback = cb;
    useEffect(() => cb(), [cb]);
  });
});

describe('the settings backup time is read on focus', () => {
  it('reads once however many times the screen re-renders', () => {
    const { result, rerender } = renderHook(() => useLastBackupTimestamp());
    expect(result.current).toBe(1_700_000_000_000);

    for (let render = 0; render < 20; render++) rerender(undefined);

    expect(mockRead).toHaveBeenCalledTimes(1);
  });

  it('reads again when the screen is focused after a backup elsewhere', () => {
    const { result } = renderHook(() => useLastBackupTimestamp());
    mockRead.mockReturnValue(1_700_000_999_000);

    act(() => focusCallback?.());

    expect(result.current).toBe(1_700_000_999_000);
  });

  it('reports never backed up as null rather than a date at the epoch', () => {
    mockRead.mockReturnValue(null);
    const { result } = renderHook(() => useLastBackupTimestamp());

    expect(result.current).toBeNull();
  });
});
