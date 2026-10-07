/**
 * Scenario: on Android a press styled with `pressable()` changed nothing on
 * screen, because the helper dims on iOS only and the ripple is a prop a call
 * site has to pass beside it.
 *
 * Expected behaviour: on Android the shared ripple is defined and the helper
 * adds no opacity, so the ripple is the feedback; on iOS there is no ripple and
 * a press fades.
 */

function load(os: 'android' | 'ios') {
  jest.resetModules();
  const actual = jest.requireActual('react-native/Libraries/Utilities/Platform');
  jest.doMock('react-native/Libraries/Utilities/Platform', () => ({
    ...actual,
    __esModule: true,
    default: {
      ...actual.default,
      OS: os,
      select: (spec: Record<string, unknown>) => (os in spec ? spec[os] : spec.default),
    },
  }));
  return require('@/shared/ui/pressFeedback') as typeof import('@/shared/ui/pressFeedback');
}

afterEach(() => jest.dontMock('react-native/Libraries/Utilities/Platform'));

it('gives Android a ripple and no opacity change', () => {
  const { pressRipple, pressable } = load('android');

  expect(pressRipple).toEqual({ borderless: false });
  expect(pressable()({ pressed: true })).toEqual([undefined, null]);
});

it('gives iOS a fade and no ripple', () => {
  const { pressRipple, pressable, PRESS_OPACITY } = load('ios');

  expect(pressRipple).toBeUndefined();
  expect(pressable()({ pressed: true })).toEqual([undefined, { opacity: PRESS_OPACITY }]);
  expect(pressable()({ pressed: false })).toEqual([undefined, null]);
});
