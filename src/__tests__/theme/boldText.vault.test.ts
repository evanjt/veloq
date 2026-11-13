/**
 * Scenario: the athlete turns on Bold Text (iOS) or Bold text (Android), and
 * the platform bolds its own clock and headers while every line the app draws
 * in its embedded face stays at the weight it was given.
 * Expected behaviour: with the setting on, each requested weight draws one
 * shipped file heavier, 400 as 600 and 600 or 700 as 700, and the type scale
 * built at launch carries the stepped weights. With the setting off, or no
 * native module to ask, every weight draws as before.
 */

import type { TextStyle } from 'react-native';

type Typography = typeof import('@/theme/typography');
type ModuleLookup = (name: string) => unknown;

/**
 * The type scale's module as it loads when the native module answers through
 * `lookup`. It is required here rather than imported, because a module already
 * in the registry ignores a mock set afterwards.
 */
function loadWith(lookup: ModuleLookup): Typography {
  let loaded: Typography | undefined;
  jest.isolateModules(() => {
    jest.doMock('expo-modules-core', () => ({
      ...jest.requireActual<object>('expo-modules-core'),
      requireOptionalNativeModule: lookup,
    }));
    loaded = require('@/theme/typography');
  });
  jest.dontMock('expo-modules-core');
  return loaded!;
}

const scaleWith = (lookup: ModuleLookup): Record<string, TextStyle> => loadWith(lookup).typography;

const reporting =
  (boldText: boolean): ModuleLookup =>
  (name) =>
    name === 'VeloqAccessibility' ? { boldText: () => boldText } : null;

describe('faceWeight under the bold text setting', () => {
  const { faceWeight } = loadWith(() => null);

  it.each([
    ['400', '600'],
    ['normal', '600'],
    [undefined, '600'],
    ['500', '700'],
    ['600', '700'],
    ['700', '700'],
    ['bold', '700'],
    ['800', '700'],
  ] as const)('steps %s to %s when the setting is on', (weight, stepped) => {
    expect(faceWeight(weight, true)).toBe(stepped);
  });

  it.each([
    ['400', '400'],
    ['500', '600'],
    ['600', '600'],
    ['700', '700'],
  ] as const)('leaves %s at %s when the setting is off', (weight, drawn) => {
    expect(faceWeight(weight, false)).toBe(drawn);
  });
});

describe('the type scale read at launch', () => {
  it('steps every role when the platform reports bold text', () => {
    const scale = scaleWith(reporting(true));
    expect(scale.body.fontWeight).toBe('600');
    expect(scale.bodyBold.fontWeight).toBe('700');
    expect(scale.screenTitle.fontWeight).toBe('700');
  });

  it('keeps every role when the platform reports it off', () => {
    const scale = scaleWith(reporting(false));
    expect(scale.body.fontWeight).toBe('400');
    expect(scale.bodyBold.fontWeight).toBe('600');
    expect(scale.screenTitle.fontWeight).toBe('700');
  });

  it('keeps every role when there is no native module', () => {
    expect(scaleWith(() => null).body.fontWeight).toBe('400');
  });

  it('keeps every role when the native read throws', () => {
    const scale = scaleWith(() => {
      throw new Error('native module unavailable');
    });
    expect(scale.body.fontWeight).toBe('400');
    expect(scale.bodyBold.fontWeight).toBe('600');
  });
});
