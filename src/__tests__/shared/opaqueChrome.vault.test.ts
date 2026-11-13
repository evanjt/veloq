/**
 * Scenario: an athlete turns on Reduce Transparency or Increase Contrast on
 * iOS, or high-contrast text on Android, so translucent chrome over a map or a
 * scrolling list loses the contrast it borrows from what is beneath it.
 *
 * Expected behaviour: the theme reads those settings once, follows their
 * changes, and exposes one flag asking chrome to draw opaque. A platform that
 * cannot answer leaves the flag off rather than throwing.
 */

import { AccessibilityInfo, Platform } from 'react-native';

import { useOpaqueChromeStore, watchOpaqueChrome } from '@/shared/app/ThemeProvider';

type Listener = (enabled: boolean) => void;

const listeners = new Map<string, Listener>();
const originalOS = Platform.OS;

function settle() {
  return new Promise((resolve) => setImmediate(resolve));
}

function preferOpaque() {
  return useOpaqueChromeStore.getState().preferOpaqueChrome;
}

let stop: (() => void) | null = null;

beforeEach(() => {
  jest.clearAllMocks();
  listeners.clear();
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((
    event: string,
    handler: Listener
  ) => {
    listeners.set(event, handler);
    return { remove: () => listeners.delete(event) };
  }) as never);
  jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'isDarkerSystemColorsEnabled').mockResolvedValue(false);
  jest.spyOn(AccessibilityInfo, 'isHighTextContrastEnabled').mockResolvedValue(false);
});

afterEach(() => {
  stop?.();
  stop = null;
  Platform.OS = originalOS;
  jest.restoreAllMocks();
});

describe('opaque chrome preference on iOS', () => {
  beforeEach(() => {
    Platform.OS = 'ios';
  });

  it('is off with every setting off', async () => {
    stop = watchOpaqueChrome();
    await settle();

    expect(preferOpaque()).toBe(false);
  });

  it('turns on with Reduce Transparency', async () => {
    jest.spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled').mockResolvedValue(true);

    stop = watchOpaqueChrome();
    await settle();

    expect(preferOpaque()).toBe(true);
  });

  it('turns on with Increase Contrast', async () => {
    jest.spyOn(AccessibilityInfo, 'isDarkerSystemColorsEnabled').mockResolvedValue(true);

    stop = watchOpaqueChrome();
    await settle();

    expect(preferOpaque()).toBe(true);
  });

  it('follows the setting when it changes while the app runs', async () => {
    stop = watchOpaqueChrome();
    await settle();

    listeners.get('reduceTransparencyChanged')?.(true);
    expect(preferOpaque()).toBe(true);

    listeners.get('darkerSystemColorsChanged')?.(true);
    listeners.get('reduceTransparencyChanged')?.(false);
    expect(preferOpaque()).toBe(true);

    listeners.get('darkerSystemColorsChanged')?.(false);
    expect(preferOpaque()).toBe(false);
  });

  it('keeps a change heard before the first read resolves', async () => {
    let resolveRead: (on: boolean) => void = () => {};
    jest
      .spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled')
      .mockReturnValue(new Promise<boolean>((resolve) => (resolveRead = resolve)));

    stop = watchOpaqueChrome();
    listeners.get('reduceTransparencyChanged')?.(true);
    resolveRead(false);
    await settle();

    expect(preferOpaque()).toBe(true);
  });

  it('stays off when the platform cannot answer', async () => {
    jest
      .spyOn(AccessibilityInfo, 'isReduceTransparencyEnabled')
      .mockRejectedValue(new Error('unavailable'));

    stop = watchOpaqueChrome();
    await settle();

    expect(preferOpaque()).toBe(false);
  });

  it('subscribes once however many times it is started', async () => {
    stop = watchOpaqueChrome();
    watchOpaqueChrome();
    await settle();

    expect(AccessibilityInfo.isReduceTransparencyEnabled).toHaveBeenCalledTimes(1);
    expect(AccessibilityInfo.addEventListener).toHaveBeenCalledTimes(2);
  });
});

describe('opaque chrome preference on Android', () => {
  beforeEach(() => {
    Platform.OS = 'android';
  });

  it('turns on with high-contrast text', async () => {
    jest.spyOn(AccessibilityInfo, 'isHighTextContrastEnabled').mockResolvedValue(true);

    stop = watchOpaqueChrome();
    await settle();

    expect(preferOpaque()).toBe(true);
  });

  it('follows high-contrast text when it changes', async () => {
    stop = watchOpaqueChrome();
    await settle();

    listeners.get('highTextContrastChanged')?.(true);
    expect(preferOpaque()).toBe(true);

    listeners.get('highTextContrastChanged')?.(false);
    expect(preferOpaque()).toBe(false);
  });

  it('reads none of the iOS-only settings', async () => {
    stop = watchOpaqueChrome();
    await settle();

    expect(AccessibilityInfo.isReduceTransparencyEnabled).not.toHaveBeenCalled();
    expect(AccessibilityInfo.isDarkerSystemColorsEnabled).not.toHaveBeenCalled();
    expect([...listeners.keys()]).toEqual(['highTextContrastChanged']);
  });
});
