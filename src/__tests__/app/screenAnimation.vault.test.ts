/**
 * Scenario: the root stack's screens each set `animation: undefined`, which
 * overrode the stack's `slide_from_right` on Android, so every pushed screen
 * opened with the platform default. A type cleanup that omitted the key let the
 * stack value through and changed every Android transition without anyone
 * asking for it.
 *
 * Expected behaviour: the tabs switch instantly, and every other route names
 * the platform default outright, so no stack-wide value can leak through.
 */

import { SCREEN_HEADERS, screenAnimation } from '@/shared/app/screenHeaders';

describe('screenAnimation', () => {
  it('switches the tabs without a transition', () => {
    expect(screenAnimation('(tabs)')).toBe('none');
  });

  it('gives every other root route the platform default', () => {
    for (const name of Object.keys(SCREEN_HEADERS).filter((n) => n !== '(tabs)')) {
      expect(screenAnimation(name)).toBe('default');
    }
  });
});
