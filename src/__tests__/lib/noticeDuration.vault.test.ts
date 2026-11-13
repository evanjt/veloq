/**
 * Scenario: a notice offers Undo, which takes longer to reach than a plain confirmation to read.
 * Expected behaviour: with no duration named, a notice with an action stays 7 seconds and one
 * without stays 4; a duration the caller names is kept either way.
 */

import { NOTICE_DEFAULT_MS, NOTICE_LONG_MS, noticeDuration } from '@/shared/ui/Notice';

const undo = { label: 'Undo', onPress: () => {} };

describe('how long a notice stays', () => {
  it('gives a notice with an action the long duration', () => {
    expect(noticeDuration({ message: 'Kite stowed', action: undo })).toBe(NOTICE_LONG_MS);
    expect(NOTICE_LONG_MS).toBe(7000);
  });

  it('gives a notice without an action the default duration', () => {
    expect(noticeDuration({ message: 'Kite stowed' })).toBe(NOTICE_DEFAULT_MS);
    expect(NOTICE_DEFAULT_MS).toBe(4000);
  });

  it('keeps a duration the caller names, with or without an action', () => {
    expect(noticeDuration({ message: 'Kite stowed', action: undo, duration: 3000 })).toBe(3000);
    expect(noticeDuration({ message: 'Kite stowed', duration: NOTICE_LONG_MS })).toBe(
      NOTICE_LONG_MS
    );
  });
});
