/**
 * Scenario: the recording screen locks itself so pocket touches are ignored,
 * and the rider unlocks with a slide.
 * Expected behaviour: starting a recording locks, an explicit unlock survives
 * a pause and resume, and a fresh recording locks again.
 */

import { renderHook, act } from '@testing-library/react-native';

import { useRecordingLock } from '@/features/recording/hooks/useRecordingLock';
import type { RecordingStatus } from '@/features/recording/types';

function lockFor(initial: RecordingStatus) {
  return renderHook(({ status }: { status: RecordingStatus }) => useRecordingLock(status), {
    initialProps: { status: initial },
  });
}

describe('useRecordingLock', () => {
  it('locks when a recording starts', () => {
    const { result, rerender } = lockFor('stopped');
    act(() => result.current.unlock());
    expect(result.current.isLocked).toBe(false);

    rerender({ status: 'recording' });

    expect(result.current.isLocked).toBe(true);
  });

  it('keeps an explicit unlock across a pause and resume', () => {
    const { result, rerender } = lockFor('stopped');
    rerender({ status: 'recording' });
    act(() => result.current.unlock());

    rerender({ status: 'paused' });
    rerender({ status: 'recording' });

    expect(result.current.isLocked).toBe(false);
  });

  it('locks again for a new recording after the previous one stopped', () => {
    const { result, rerender } = lockFor('stopped');
    rerender({ status: 'recording' });
    act(() => result.current.unlock());
    rerender({ status: 'stopped' });

    rerender({ status: 'recording' });

    expect(result.current.isLocked).toBe(true);
  });

  it('still locks on demand', () => {
    const { result, rerender } = lockFor('stopped');
    rerender({ status: 'recording' });
    act(() => result.current.unlock());

    act(() => result.current.lock());

    expect(result.current.isLocked).toBe(true);
  });
});
