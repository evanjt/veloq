/**
 * Scenario: the app launches locked to portrait, and a foldable's unfolded display is meant to turn
 * with the hand. The Info.plist cannot unlock one display only, so the app asks at runtime.
 *
 * Expected behaviour: a regular-width window on iOS unlocks every orientation, a compact window
 * is locked to portrait, and only a change of window class asks again. A compact phone turned
 * into landscape for the full-screen plot stays compact and so is never locked back to portrait
 * under the plot.
 */
import { act, renderHook } from '@testing-library/react-native';
import { OrientationLock, lockAsync } from 'expo-screen-orientation';

import { appOrientationLock, useAppOrientation } from '@/shared/app/appOrientation';
import { mapSheetPanelWidth } from '@/shared/app/screenHeaders';

jest.mock('expo-screen-orientation', () => ({
  ...jest.requireActual('expo-screen-orientation'),
  lockAsync: jest.fn(() => Promise.resolve()),
}));

const mockWindow = {
  size: { width: 466, height: 678 },
  listeners: new Set<() => void>(),
  resize(size: { width: number; height: number }) {
    this.size = size;
    this.listeners.forEach((listener) => listener());
  },
};
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useWindowDimensions'),
  __esModule: true,
  default: () => {
    const size = require('react').useSyncExternalStore(
      (listener: () => void) => {
        mockWindow.listeners.add(listener);
        return () => mockWindow.listeners.delete(listener);
      },
      () => mockWindow.size
    );
    return { ...size, scale: 3, fontScale: 1 };
  },
}));

const FOLDED = { width: 466, height: 678 };
const PHONE_ON_ITS_SIDE = { width: 852, height: 393 };
const UNFOLDED_UPRIGHT = { width: 669, height: 951 };
const UNFOLDED_ON_ITS_SIDE = { width: 951, height: 669 };

const lock = lockAsync as jest.Mock;

beforeEach(() => {
  lock.mockClear();
  mockWindow.size = FOLDED;
});

describe('appOrientationLock', () => {
  it.each([
    ['a compact window', 'ios', FOLDED, OrientationLock.PORTRAIT_UP],
    ['a phone on its side', 'ios', PHONE_ON_ITS_SIDE, OrientationLock.PORTRAIT_UP],
    ['an unfolded display upright', 'ios', UNFOLDED_UPRIGHT, OrientationLock.ALL],
    ['an unfolded display on its side', 'ios', UNFOLDED_ON_ITS_SIDE, OrientationLock.ALL],
    ['a wide Android window', 'android', UNFOLDED_UPRIGHT, null],
  ])('gives %s its lock', (_name, os, window, expected) => {
    expect(appOrientationLock(os, window)).toBe(expected);
  });
});

describe('the unfolded display in both poses', () => {
  it.each([
    ['upright', UNFOLDED_UPRIGHT, 360],
    ['on its side', UNFOLDED_ON_ITS_SIDE, 380],
  ])('docks a side panel and leaves the map a phone-width pane %s', (_pose, window, panel) => {
    expect(mapSheetPanelWidth(window)).toBe(panel);
    expect(window.width - panel).toBeGreaterThanOrEqual(300);
  });

  it('raising the panel threshold past the upright width would lock the display to portrait', () => {
    expect(mapSheetPanelWidth(UNFOLDED_UPRIGHT)).not.toBeNull();
    expect(appOrientationLock('ios', UNFOLDED_UPRIGHT)).toBe(OrientationLock.ALL);
  });
});

describe('useAppOrientation', () => {
  it('locks a compact window to portrait on mount and unlocks it as the display unfolds', () => {
    renderHook(() => useAppOrientation('ios'));
    expect(lock.mock.calls).toEqual([[OrientationLock.PORTRAIT_UP]]);

    act(() => mockWindow.resize(UNFOLDED_UPRIGHT));
    expect(lock.mock.calls.at(-1)).toEqual([OrientationLock.ALL]);

    act(() => mockWindow.resize(FOLDED));
    expect(lock.mock.calls.at(-1)).toEqual([OrientationLock.PORTRAIT_UP]);
  });

  it('asks nothing again while the display turns between its two unfolded poses', () => {
    mockWindow.size = UNFOLDED_UPRIGHT;
    renderHook(() => useAppOrientation('ios'));
    expect(lock).toHaveBeenCalledTimes(1);

    act(() => mockWindow.resize(UNFOLDED_ON_ITS_SIDE));
    act(() => mockWindow.resize(UNFOLDED_UPRIGHT));

    expect(lock).toHaveBeenCalledTimes(1);
  });

  it('leaves a phone turned into landscape for the plot alone', () => {
    mockWindow.size = { width: 393, height: 852 };
    renderHook(() => useAppOrientation('ios'));
    lock.mockClear();

    act(() => mockWindow.resize(PHONE_ON_ITS_SIDE));

    expect(lock).not.toHaveBeenCalled();
  });

  it('requests nothing on Android, whose manifest and opt-out already decide', () => {
    mockWindow.size = UNFOLDED_UPRIGHT;
    renderHook(() => useAppOrientation('android'));
    expect(lock).not.toHaveBeenCalled();
  });
});
