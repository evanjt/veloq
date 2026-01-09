/**
 * Tests for useRouteSyncProgress hook
 *
 * Tests progress state management with mount-safe updates.
 */

import { renderHook, act } from '@testing-library/react';
import { useRouteSyncProgress } from '@/hooks/routes/useRouteSyncProgress';

describe('useRouteSyncProgress', () => {
  it('should initialize with idle state', () => {
    const { result } = renderHook(() => useRouteSyncProgress());

    expect(result.current.progress).toEqual({
      status: 'idle',
      completed: 0,
      total: 0,
      message: '',
    });
  });

  it('should update progress state', () => {
    const { result } = renderHook(() => useRouteSyncProgress());

    act(() => {
      result.current.updateProgress({
        status: 'syncing',
        completed: 5,
        total: 10,
        message: 'Syncing...',
      });
    });

    expect(result.current.progress).toEqual({
      status: 'syncing',
      completed: 5,
      total: 10,
      message: 'Syncing...',
    });
  });

  it('should support functional updates', () => {
    const { result } = renderHook(() => useRouteSyncProgress());

    // Set initial state
    act(() => {
      result.current.updateProgress({
        status: 'syncing',
        completed: 5,
        total: 10,
      });
    });

    // Update using function
    act(() => {
      result.current.updateProgress((prev) => ({
        ...prev,
        completed: prev.completed + 1,
      }));
    });

    expect(result.current.progress.completed).toBe(6);
  });

  it('should reset progress', () => {
    const { result } = renderHook(() => useRouteSyncProgress());

    act(() => {
      result.current.updateProgress({
        status: 'syncing',
        completed: 8,
        total: 10,
        message: 'Almost done',
      });
    });

    act(() => {
      result.current.resetProgress();
    });

    expect(result.current.progress).toEqual({
      status: 'idle',
      completed: 0,
      total: 0,
      message: '',
    });
  });

  it('should not update after unmount', () => {
    const { result, unmount } = renderHook(() => useRouteSyncProgress());

    unmount();

    act(() => {
      result.current.updateProgress({
        status: 'syncing',
        completed: 5,
        total: 10,
      });
    });

    // Should not crash, state should remain idle
    expect(result.current.progress.status).toBe('idle');
  });

  it('should calculate completion percentage', () => {
    const { result } = renderHook(() => useRouteSyncProgress());

    act(() => {
      result.current.updateProgress({
        status: 'syncing',
        completed: 5,
        total: 10,
      });
    });

    expect(result.current.completionPercent).toBe(50);

    act(() => {
      result.current.updateProgress((prev) => ({
        ...prev,
        completed: 10,
      }));
    });

    expect(result.current.completionPercent).toBe(100);
  });

  it('should handle zero total gracefully', () => {
    const { result } = renderHook(() => useRouteSyncProgress());

    act(() => {
      result.current.updateProgress({
        status: 'idle',
        completed: 0,
        total: 0,
      });
    });

    expect(result.current.completionPercent).toBe(0);
  });

  it('should track isSyncing state', () => {
    const { result } = renderHook(() => useRouteSyncProgress());

    expect(result.current.isSyncing).toBe(false);

    act(() => {
      result.current.updateProgress({
        status: 'syncing',
        completed: 1,
        total: 10,
      });
    });

    expect(result.current.isSyncing).toBe(true);

    act(() => {
      result.current.updateProgress({
        status: 'complete',
        completed: 10,
        total: 10,
      });
    });

    expect(result.current.isSyncing).toBe(false);
  });

  it('should provide convenience setters', () => {
    const { result } = renderHook(() => useRouteSyncProgress());

    act(() => {
      result.current.setSyncing(5, 10);
    });

    expect(result.current.progress).toEqual({
      status: 'syncing',
      completed: 5,
      total: 10,
      message: '',
    });

    act(() => {
      result.current.setComplete();
    });

    expect(result.current.progress.status).toBe('complete');

    act(() => {
      result.current.setError('Sync failed');
    });

    expect(result.current.progress).toEqual({
      status: 'error',
      completed: 0,
      total: 0,
      message: 'Sync failed',
    });
  });
});

describe('Integration Tests', () => {
  it('should handle typical sync flow', () => {
    const { result } = renderHook(() => useRouteSyncProgress());

    // Start sync
    act(() => {
      result.current.setSyncing(0, 10);
    });
    expect(result.current.isSyncing).toBe(true);
    expect(result.current.completionPercent).toBe(0);

    // Update progress
    act(() => {
      result.current.updateProgress((prev) => ({
        ...prev,
        completed: prev.completed + 5,
      }));
    });
    expect(result.current.completionPercent).toBe(50);

    // Complete
    act(() => {
      result.current.setComplete();
    });
    expect(result.current.isSyncing).toBe(false);
    expect(result.current.completionPercent).toBe(100);
  });

  it('should handle error during sync', () => {
    const { result } = renderHook(() => useRouteSyncProgress());

    act(() => {
      result.current.setSyncing(5, 10);
    });

    act(() => {
      result.current.setError('Network error');
    });

    expect(result.current.progress.status).toBe('error');
    expect(result.current.progress.message).toBe('Network error');
    expect(result.current.isSyncing).toBe(false);
  });

  it('should handle recovery after error', () => {
    const { result } = renderHook(() => useRouteSyncProgress());

    // Error state
    act(() => {
      result.current.setError('Failed');
    });
    expect(result.current.progress.status).toBe('error');

    // Retry
    act(() => {
      result.current.setSyncing(0, 5);
    });
    expect(result.current.progress.status).toBe('syncing');

    // Success
    act(() => {
      result.current.setComplete();
    });
    expect(result.current.progress.status).toBe('complete');
  });
});
