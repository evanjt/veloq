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
import { render } from '@testing-library/react-native';

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

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: (selector: (state: unknown) => unknown) =>
    selector({
      gpsSyncProgress: { status: 'fetching', current: 4, total: 10 },
      isGpsSyncing: true,
      extendedFetch: { running: true },
    }),
}));

jest.mock('@/shared/app/extendedFetch', () => ({ isExtendedFetchRunning: () => false }));

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
