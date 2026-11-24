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

import {
  useAutoBackupEnabled,
  useLastBackupTimestamp,
} from '@/features/settings/hooks/useLastBackupTimestamp';
import { getLastBackupTimestamp, isAutoBackupEnabled } from '@/features/settings/lib/autobackup';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

let focusCallback: (() => void) | null = null;
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useFocusEffect: jest.fn(),
}));

jest.mock('@/features/settings/lib/autobackup', () => ({
  getLastBackupTimestamp: jest.fn(() => 1_700_000_000_000),
  isAutoBackupEnabled: jest.fn(() => true),
}));

const mockRead = getLastBackupTimestamp as jest.MockedFunction<typeof getLastBackupTimestamp>;
const mockEnabled = isAutoBackupEnabled as jest.MockedFunction<typeof isAutoBackupEnabled>;

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
  vaultIt('reads once however many times the screen re-renders', async () => {
    const { result, rerender } = await renderHook(() => useLastBackupTimestamp());
    expect(result.current).toBe(1_700_000_000_000);

    for (let render = 0; render < 20; render++) await rerender(undefined);

    expect(mockRead).toHaveBeenCalledTimes(1);
  });

  it('reads again when the screen is focused after a backup elsewhere', async () => {
    const { result } = await renderHook(() => useLastBackupTimestamp());
    mockRead.mockReturnValue(1_700_000_999_000);

    await act(() => focusCallback?.());

    expect(result.current).toBe(1_700_000_999_000);
  });

  it('reports never backed up as null rather than a date at the epoch', async () => {
    mockRead.mockReturnValue(null);
    const { result } = await renderHook(() => useLastBackupTimestamp());

    expect(result.current).toBeNull();
  });

  it('reports the backup time as unknown before the first focus, not never', async () => {
    (useFocusEffect as jest.Mock).mockImplementation(() => {});
    const { result } = await renderHook(() => useLastBackupTimestamp());

    expect(result.current).toBeUndefined();
  });

  it('reports auto-backup as unknown before the first focus, not off', async () => {
    (useFocusEffect as jest.Mock).mockImplementation(() => {});
    mockEnabled.mockReturnValue(true);
    const { result } = await renderHook(() => useAutoBackupEnabled());

    expect(result.current).toBeUndefined();
  });

  it('reads auto-backup on focus', async () => {
    mockEnabled.mockReturnValue(true);
    const { result } = await renderHook(() => useAutoBackupEnabled());

    expect(result.current).toBe(true);
  });
});
