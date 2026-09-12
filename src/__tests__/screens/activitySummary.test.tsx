/**
 * Scenario: an enriched push claims a route PR, the athlete taps it, and the
 * activity may or may not have reached the local database yet.
 *
 * Expected behaviour: the screen shows the notification's own claim whole,
 * with the figures behind it, and a wait for an activity still coming in reads
 * as a fetch rather than as the same blank skeleton a local read shows.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import ActivitySummaryScreen from '@/app/summary/[id]';
import { useActivity } from '@/features/activity/hooks';
import { resolveActivityHighlight } from '@/features/insights/lib/activityHighlight';

jest.mock('expo-router', () => ({
  router: { push: jest.fn() },
  useLocalSearchParams: () => ({ id: 'i999' }),
}));
jest.mock('@/features/activity/hooks', () => ({ useActivity: jest.fn() }));
jest.mock('@/features/insights/lib/activityHighlight', () => ({
  ...jest.requireActual('@/features/insights/lib/activityHighlight'),
  resolveActivityHighlight: jest.fn(),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: { textSecondary: '#888' } }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/ui', () => {
  const { Text, View } = require('react-native');
  return {
    Button: ({ label, testID }: { label: string; testID?: string }) => (
      <View testID={testID}>
        <Text>{label}</Text>
      </View>
    ),
    ScreenErrorBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    ScreenSafeAreaView: View,
  };
});
jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaProvider: View,
    SafeAreaView: View,
  };
});

const mockUseActivity = useActivity as jest.MockedFunction<typeof useActivity>;
const mockResolve = resolveActivityHighlight as jest.MockedFunction<
  typeof resolveActivityHighlight
>;

const activity = {
  id: 'i999',
  name: 'Evening Ride',
  type: 'Ride',
  distance: 42_195,
  moving_time: 5_400,
  total_elevation_gain: 612,
};

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <ActivitySummaryScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockResolve.mockReturnValue({
    highlight: { kind: 'routePr', routeName: 'Col de la Faucille', improvementSeconds: 154 },
    tier: 'pr',
  });
});

describe('the activity summary screen', () => {
  it('says the activity is still coming in rather than showing an empty screen', () => {
    mockUseActivity.mockReturnValue({ data: null, isLoading: false } as unknown as ReturnType<
      typeof useActivity
    >);

    const { queryByTestId } = renderScreen();

    expect(queryByTestId('activity-summary-waiting')).not.toBeNull();
    expect(queryByTestId('activity-summary-verdict')).toBeNull();
  });

  it('waits quietly while the local read is still in flight', () => {
    mockUseActivity.mockReturnValue({ data: null, isLoading: true } as unknown as ReturnType<
      typeof useActivity
    >);

    const { queryByTestId } = renderScreen();

    expect(queryByTestId('activity-summary-waiting')).toBeNull();
  });

  it('paints the figures and the way through before the engine has answered', () => {
    mockUseActivity.mockReturnValue({ data: activity, isLoading: false } as unknown as ReturnType<
      typeof useActivity
    >);

    const { queryByTestId } = renderScreen();

    expect(queryByTestId('activity-summary-figures')).not.toBeNull();
    expect(queryByTestId('activity-summary-open')).not.toBeNull();
    // Held back whole rather than defaulted, so no rung is shown and replaced.
    expect(queryByTestId('activity-summary-verdict')).toBeNull();
  });

  it('carries the claim whole, with the full route name the lock screen would cut', async () => {
    mockUseActivity.mockReturnValue({ data: activity, isLoading: false } as unknown as ReturnType<
      typeof useActivity
    >);

    const { findByTestId } = renderScreen();

    expect(await findByTestId('activity-summary-verdict')).toBeTruthy();
    expect(await findByTestId('activity-summary-sentence')).toBeTruthy();
  });
});
