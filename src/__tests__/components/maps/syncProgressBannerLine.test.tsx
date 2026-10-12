/**
 * Scenario: the map's sync banner shows the older-activities fetch, then the
 * heatmap pass, in real en-GB copy.
 *
 * Expected behaviour: the banner prints the line the formatter gives it and
 * adds nothing. It used to append its own ellipsis and figure, so a string that
 * already ended in one read "Loading older activities......" and a stage with a
 * figure of its own carried two.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { SyncProgressBanner } from '@/features/maps/components/timeline/SyncProgressBanner';
import { tilePassProgress } from '@/features/routes/lib/tilePass';
import { i18n, initialiseI18n } from '@/i18n';

const mockState: { current: Record<string, unknown> } = { current: {} };

jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual('react-native');
  return {
    ...jest.requireActual('react-native-reanimated'),
    __esModule: true,
    default: { View },
    useSharedValue: (initial: number) => {
      const ref = jest.requireActual('react').useRef({ value: initial });
      return ref.current;
    },
    useAnimatedStyle: (build: () => unknown) => build(),
    withTiming: (toValue: number) => toValue,
    withRepeat: (animation: unknown) => animation,
    cancelAnimation: jest.fn(),
  };
});

jest.mock('@/shared/app/SyncDateRangeStore', () => ({
  useSyncDateRange: (selector: (state: unknown) => unknown) => selector(mockState.current),
}));

jest.mock('@/shared/app/extendedFetch', () => ({
  isExtendedFetchRunning: (fetch: { running: boolean }) => fetch.running,
}));

jest.mock('@/shared/native/useLibraryCoverage', () => ({
  useLibraryCoverage: () => null,
}));

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

function bannerLine(): string {
  const { getByTestId } = render(<SyncProgressBanner />);
  const children = getByTestId('sync-progress-message').props.children;
  return ([] as unknown[]).concat(children).join('');
}

it('prints one ellipsis while older activities load', () => {
  mockState.current = {
    gpsSyncProgress: { status: 'idle', completed: 0, total: 0, percent: 0, message: '' },
    isGpsSyncing: false,
    isAnalysingInBackground: false,
    extendedFetch: { running: true },
  };

  const line = bannerLine();

  expect(line).not.toContain('......');
  expect(line).not.toContain('...');
  expect(line.split('…').length - 1).toBe(1);
});

it('prints one figure during the heatmap pass', () => {
  mockState.current = {
    gpsSyncProgress: tilePassProgress(40, 100, i18n.t),
    isGpsSyncing: true,
    isAnalysingInBackground: false,
    extendedFetch: { running: false },
  };

  const line = bannerLine();

  expect(line.split('%').length - 1).toBe(1);
  expect(line).toContain('85%');
});
