/**
 * Scenario: the system back control on the live screen and the review screen. The lock is the
 * athlete's own statement that no input should act, and an upload in flight hides the review's
 * own back control.
 *
 * Expected behaviour: back is consumed while the live screen is locked mid-ride and while the
 * review is processing. Unlocked mid-ride it leaves the screen with the ride still running, and
 * with no ride under way it is an ordinary back.
 */

import { recordingBackAction } from '@/features/recording/lib/recordingBackAction';

describe('recordingBackAction', () => {
  it.each(['recording', 'paused'] as const)('consumes back on a locked %s ride', (status) => {
    expect(recordingBackAction({ status, isLocked: true, isProcessing: false })).toBe('consume');
  });

  it.each(['recording', 'paused'] as const)(
    'leaves an unlocked %s ride running behind the screen',
    (status) => {
      expect(recordingBackAction({ status, isLocked: false, isProcessing: false })).toBe('leave');
    }
  );

  it.each(['idle', 'stopped'] as const)('passes back through with the screen %s', (status) => {
    expect(recordingBackAction({ status, isLocked: true, isProcessing: false })).toBe('pass');
    expect(recordingBackAction({ status, isLocked: false, isProcessing: false })).toBe('pass');
  });

  it('consumes back while the review is processing, whatever the lock says', () => {
    expect(recordingBackAction({ status: 'stopped', isLocked: false, isProcessing: true })).toBe(
      'consume'
    );
    expect(recordingBackAction({ status: 'stopped', isLocked: true, isProcessing: true })).toBe(
      'consume'
    );
  });

  it('passes back on the review once processing ends', () => {
    expect(recordingBackAction({ status: 'stopped', isLocked: false, isProcessing: false })).toBe(
      'pass'
    );
  });
});
