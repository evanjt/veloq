/**
 * Scenario: the map timeline re-renders while the sync banner is on screen,
 * which the timeline does on every store tick.
 *
 * Expected behaviour: the banner drives its shared values from an effect. A
 * `withTiming` written in the render body restarts both animations on every
 * render, including the renders React throws away, so the height eases from
 * wherever it had got to and the bar never settles.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, render } from '@testing-library/react-native';

// Every `jest.mock` below is hoisted above this by babel, so the banner sees
// the doubles even though it is imported here.
import { SyncProgressBanner } from '@/features/maps/components/timeline/SyncProgressBanner';

const mockWithTiming = jest.fn((toValue: number) => toValue);

// Reanimated exports its surface as non-configurable getters, so it cannot be
// spied on or spread over. The banner uses six of them and a stand-in for each
// is cheaper than reaching inside the real module.
jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual('react-native');
  return {
    ...jest.requireActual('react-native-reanimated'),
    __esModule: true,
    default: { View },
    // Stable across renders, like the real one: a fresh object every render
    // would change the effect's dependency and hide the defect.
    useSharedValue: (initial: number) => {
      const ref = jest.requireActual('react').useRef({ value: initial });
      return ref.current;
    },
    useAnimatedStyle: (build: () => unknown) => build(),
    // Called through, not passed: the banner is imported before this file's
    // own bindings are initialised, so the factory must not capture the spy.
    withTiming: (...args: unknown[]) => mockWithTiming(...(args as [number])),
    withRepeat: (animation: unknown) => animation,
    cancelAnimation: jest.fn(),
  };
});

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: (selector: (state: unknown) => unknown) =>
    selector({
      gpsSyncProgress: { status: 'fetching', current: 4, total: 10 },
      isGpsSyncing: true,
      extendedFetch: { running: true },
    }),
}));

jest.mock('@/shared/app/extendedFetch', () => ({ isExtendedFetchRunning: () => false }));

// The library figure is its own suite. Here it reports nothing, which is what
// an engine that has never synced answers anyway.
jest.mock('@/shared/native/useLibraryCoverage', () => ({
  useLibraryCoverage: () => null,
}));

describe('the sync progress banner', () => {
  beforeEach(() => mockWithTiming.mockClear());

  it('does not restart its animations when the tree re-renders unchanged', () => {
    const { rerender } = render(<SyncProgressBanner />);
    const afterMount = mockWithTiming.mock.calls.length;

    rerender(<SyncProgressBanner />);
    rerender(<SyncProgressBanner />);

    expect(mockWithTiming.mock.calls.length).toBe(afterMount);
  });

  it('still animates once on mount', () => {
    render(<SyncProgressBanner />);

    expect(mockWithTiming.mock.calls.length).toBeGreaterThan(0);
  });
});

describe('the sync progress banner height', () => {
  it('animates to the measured content height so the lines and the track are not clipped', () => {
    const { getByTestId, getByTestId: byId } = render(<SyncProgressBanner />);
    const content = byId('sync-progress-banner-content');

    act(() => {
      content.props.onLayout({ nativeEvent: { layout: { height: 75, width: 320, x: 0, y: 0 } } });
    });

    const style = StyleSheet.flatten(getByTestId('sync-progress-banner').props.style);
    expect(style.height).toBe(75);
  });

  it('follows the content when it grows after the first measure', () => {
    const { getByTestId } = render(<SyncProgressBanner />);
    const content = getByTestId('sync-progress-banner-content');

    act(() => {
      content.props.onLayout({ nativeEvent: { layout: { height: 59, width: 320, x: 0, y: 0 } } });
    });
    act(() => {
      content.props.onLayout({ nativeEvent: { layout: { height: 75, width: 320, x: 0, y: 0 } } });
    });

    expect(StyleSheet.flatten(getByTestId('sync-progress-banner').props.style).height).toBe(75);
  });
});
