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
  it('locks when a recording starts', async () => {
    const { result, rerender } = await lockFor('stopped');
    await act(() => result.current.unlock());
    expect(result.current.isLocked).toBe(false);

    await rerender({ status: 'recording' });

    expect(result.current.isLocked).toBe(true);
  });

  it('keeps an explicit unlock across a pause and resume', async () => {
    const { result, rerender } = await lockFor('stopped');
    await rerender({ status: 'recording' });
    await act(() => result.current.unlock());

    await rerender({ status: 'paused' });
    await rerender({ status: 'recording' });

    expect(result.current.isLocked).toBe(false);
  });

  it('locks again for a new recording after the previous one stopped', async () => {
    const { result, rerender } = await lockFor('stopped');
    await rerender({ status: 'recording' });
    await act(() => result.current.unlock());
    await rerender({ status: 'stopped' });

    await rerender({ status: 'recording' });

    expect(result.current.isLocked).toBe(true);
  });

  it('still locks on demand', async () => {
    const { result, rerender } = await lockFor('stopped');
    await rerender({ status: 'recording' });
    await act(() => result.current.unlock());

    await act(() => result.current.lock());

    expect(result.current.isLocked).toBe(true);
  });
});
