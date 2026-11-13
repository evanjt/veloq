/**
 * Scenario: a banner fills the top slot and pads the status bar itself. On Android the native
 * header applies the status bar inset on its own, whatever the JavaScript insets say, so the
 * header opened a status-bar-high band under the banner.
 *
 * Expected behaviour: with the slot filled, the Android stack header is told not to apply the
 * top inset; with it empty, and on iOS, the options carry no such instruction.
 */

import { stackHeaderOptions } from '@/shared/app/screenHeaders';

describe('stackHeaderOptions top inset', () => {
  it('turns the native top inset off on Android while a banner fills the slot', () => {
    const options = stackHeaderOptions('android', false, true);
    expect(options.unstable_nativeProps).toEqual({
      headerConfig: { disableTopInsetApplication: true },
    });
  });

  it('leaves the native header to apply the inset when the slot is empty', () => {
    expect(stackHeaderOptions('android', false, false)).not.toHaveProperty('unstable_nativeProps');
    expect(stackHeaderOptions('android', false)).not.toHaveProperty('unstable_nativeProps');
  });

  it('adds nothing on iOS, whose header reads the JavaScript inset', () => {
    expect(stackHeaderOptions('ios', false, true)).not.toHaveProperty('unstable_nativeProps');
  });
});
