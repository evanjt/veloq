/**
 * Scenario: the developer dashboard's Support Card preset is used to put the
 * home feed's support card up, in a session whose one ask is not free for it:
 * a sync has never settled clean, as in demo mode, or another card already took
 * the ask.
 *
 * Expected behaviour: a preset that makes the card due hands it the session's
 * ask, so the card shows; one that leaves it not due shows nothing.
 */

import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import DebugScreen from '@/app/debug';
import { SupportCard } from '@/features/home/components/SupportCard';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { useSupportStore } from '@/shared/app/SupportStore';
import { openLaunchSession } from '../__shared__/launchSession';

jest.mock('expo-constants', () => ({
  ...jest.requireActual('expo-constants'),
  expoConfig: { version: '0.0.0' },
}));
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/shared/app/useDonation', () => ({
  useDonation: () => ({
    products: [],
    isAvailable: false,
    isPurchasing: false,
    purchaseSuccess: false,
    purchase: jest.fn(),
  }),
}));
jest.mock('@/features/insights/lib/taskRunLog', () => ({
  readTaskRuns: jest.fn(async () => []),
  clearTaskRuns: jest.fn(async () => {}),
}));
// The sync tools read the activity cache and have a test of their own.
jest.mock('@/features/routes/components/SyncDebugSection', () => ({
  SyncDebugSection: () => null,
}));
jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    EngineClient: {
      getInstance: () => ({
        getStats: () => ({ activityCount: 1 }),
        dashboardData: () => ({ pushRuns: [], requestBudget: undefined }),
        engineEventDiagnostics: () => ({
          live: true,
          bindingInitError: null,
          observerError: null,
          received: {},
          delivered: {},
          listeners: {},
        }),
      }),
    },
  })
);

async function pressPreset(days: number) {
  const screen = await render(
    <View>
      <SupportCard />
      <DebugScreen />
    </View>
  );
  await act(async () => {});
  expect(screen.queryByTestId('support-card')).toBeNull();
  await fireEvent.press(screen.getByTestId('debug-section-support-card'));
  await fireEvent.press(screen.getByTestId(`debug-support-preset-${days}d`));
  await act(async () => {});
  return screen;
}

beforeEach(() => {
  useWhatsNewStore.setState({
    tourState: null,
    launchModal: null,
    restoreOffer: null,
    isLoaded: true,
    firstUseDate: null,
    useDays: 0,
  });
  useSupportStore.setState({
    isLoaded: true,
    lastActionDate: null,
    permanentlyDismissed: false,
    isLegacyPurchaser: false,
    dismissCount: 0,
  });
});

describe('the Support Card preset on the developer dashboard', () => {
  it('shows the card where no sync has settled clean', async () => {
    openLaunchSession(true);
    const screen = await pressPreset(31);
    expect(screen.getByTestId('support-card')).toBeTruthy();
  });

  it('shows the card where another card took the session ask', async () => {
    openLaunchSession();
    useWhatsNewStore.setState({ sessionAsk: 'seriesConsent', eligibleAsks: ['seriesConsent'] });
    const screen = await pressPreset(31);
    expect(screen.getByTestId('support-card')).toBeTruthy();
  });

  it('shows nothing from a preset that leaves the card not due', async () => {
    openLaunchSession();
    const screen = await pressPreset(0);
    expect(screen.queryByTestId('support-card')).toBeNull();
  });
});
