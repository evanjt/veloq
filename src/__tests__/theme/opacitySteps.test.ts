/**
 * Scenario: alpha was written at thirty values, and the iOS press fade had two
 * owners that could drift apart.
 *
 * Expected behaviour: the opacity token holds the guide's seven steps, and
 * every press fade reads the pressed step.
 */

import { Platform } from 'react-native';

import { opacity } from '@/theme';
import { PRESS_OPACITY, pressedOpacity } from '@/shared/ui/pressFeedback';

describe('the opacity token', () => {
  it('holds the seven steps of the ladder', () => {
    expect({
      tint1: opacity.tint1,
      tint2: opacity.tint2,
      tint3: opacity.tint3,
      tint4: opacity.tint4,
      dim: opacity.dim,
      disabled: opacity.disabled,
      pressed: opacity.pressed,
    }).toEqual({
      tint1: 0.06,
      tint2: 0.12,
      tint3: 0.18,
      tint4: 0.3,
      dim: 0.4,
      disabled: 0.5,
      pressed: 0.7,
    });
  });

  it('gives the press fade one value, the pressed step', () => {
    const os = Platform.OS;
    Platform.OS = 'ios';
    try {
      expect(PRESS_OPACITY).toBe(opacity.pressed);
      expect(pressedOpacity(true)).toBe(opacity.pressed);
      expect(pressedOpacity(false)).toBe(1);
    } finally {
      Platform.OS = os;
    }
  });
});
