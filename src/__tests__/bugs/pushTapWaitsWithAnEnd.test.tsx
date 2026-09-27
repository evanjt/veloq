/**
 * Scenario: a push names an activity the library does not hold. The tap opens
 * the summary, which asks the engine for that activity and waits.
 *
 * Expected behaviour: the wait says which activity is being downloaded, and it
 * ends. A fetch the engine refused is announced by nothing, so a screen that
 * only watches for the body to appear spins until it is closed. When the wait
 * runs out the screen says the activity could not be fetched and offers a
 * retry, which asks again.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ActivitySummaryScreen from '@/app/summary/[id]';
import { useActivity } from '@/features/activity/hooks';

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn() },
  useLocalSearchParams: () => ({ id: 'i999' }),
}));
jest.mock('@/features/activity/hooks', () => ({ useActivity: jest.fn() }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides({}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: { textSecondary: '#888' } }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/ui', () => {
  const { Text, View } = require('react-native');
  return {
    Button: ({
      label,
      testID,
      onPress,
    }: {
      label: string;
      testID?: string;
      onPress?: () => void;
    }) => (
      <View testID={testID} onTouchEnd={onPress}>
        <Text>{label}</Text>
      </View>
    ),
    ScreenErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    ScreenSafeAreaView: View,
  };
});

const mockUseActivity = useActivity as jest.MockedFunction<typeof useActivity>;

function answer(overrides: Record<string, unknown>) {
  mockUseActivity.mockReturnValue({
    data: null,
    isLoading: false,
    bodyStatus: 'waiting',
    retryBody: jest.fn(),
    ...overrides,
  } as unknown as ReturnType<typeof useActivity>);
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ActivitySummaryScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => jest.clearAllMocks());

describe('the wait for an activity the push named', () => {
  it('names the download rather than reusing the list screen line', () => {
    answer({});

    const { getByTestId } = renderScreen();

    expect(getByTestId('activity-summary-waiting')).toHaveTextContent(
      'activitySummary.downloading'
    );
  });

  it('gives up when the fetch is never answered, instead of spinning for ever', () => {
    answer({ bodyStatus: 'timedOut' });

    const { queryByTestId } = renderScreen();

    expect(queryByTestId('activity-summary-waiting')).toBeNull();
    expect(queryByTestId('activity-summary-unavailable')).not.toBeNull();
  });

  it('asks again when the retry is pressed', () => {
    const retryBody = jest.fn();
    answer({ bodyStatus: 'timedOut', retryBody });

    const { getByTestId } = renderScreen();
    fireEvent(getByTestId('activity-summary-retry'), 'touchEnd');

    expect(retryBody).toHaveBeenCalledTimes(1);
  });

  it('shows neither once the activity is stored', () => {
    answer({
      data: {
        id: 'i999',
        name: 'Evening Ride',
        distance: 1,
        moving_time: 1,
        total_elevation_gain: 1,
      },
      bodyStatus: 'idle',
    });

    const { queryByTestId } = renderScreen();

    expect(queryByTestId('activity-summary-waiting')).toBeNull();
    expect(queryByTestId('activity-summary-unavailable')).toBeNull();
    expect(queryByTestId('activity-summary-figures')).not.toBeNull();
  });
});
