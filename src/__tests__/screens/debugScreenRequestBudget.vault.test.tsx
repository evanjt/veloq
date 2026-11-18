/**
 * Scenario: the backfill has stopped and the phone is in hand. Whether the
 * engine is holding it back for its share of the shared request limits, or
 * for a refusal's cooldown, is invisible from anything else on screen.
 *
 * Expected behaviour: the Developer Dashboard shows the request budget beside
 * the FFI table: each intent's requests against its allowance, any cooldown,
 * and when the daily count resets.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import DebugScreen from '@/app/debug';
import { useAuthStore } from '@/shared/app/AuthStore';

jest.mock('expo-constants', () => ({
  ...jest.requireActual('expo-constants'),
  expoConfig: { version: '0.0.0' },
}));

jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

jest.mock('@/features/insights/lib/taskRunLog', () => ({
  readTaskRuns: jest.fn(async () => []),
  clearTaskRuns: jest.fn(async () => {}),
}));

const COOLDOWN_UNTIL = 1_772_619_000;
const NEXT_RESET = 1_772_670_600;

const budget = () => ({
  userToday: 41,
  syncToday: 12,
  backfillToday: 230,
  backfillPerDay: 600,
  backfillLastFifteenMinutes: 87,
  backfillPerFifteenMinutes: 100,
  syncLastFifteenMinutes: 3,
  syncPerFifteenMinutes: 50,
  cooldownUntil: COOLDOWN_UNTIL as number | undefined,
  poolRemainingFifteenMinutes: undefined as number | undefined,
  poolRemainingDaily: undefined as number | undefined,
  poolLimitFifteenMinutes: undefined as number | undefined,
  poolLimitDaily: undefined as number | undefined,
  poolSeenAt: undefined as number | undefined,
  poolHoldUntil: undefined as number | undefined,
  nextReset: NEXT_RESET,
  pairResponses: 0,
  lastRemainingFifteenMinutes: undefined as number | undefined,
  lastRemainingDaily: undefined as number | undefined,
  lastPairAt: undefined as number | undefined,
  backfillCapLifted: false,
  signedInWith: 'oauth' as string | undefined,
});

const mockRequestBudget = jest.fn(budget);

// The sync tools read the activity cache and have a test of their own.
jest.mock('@/features/routes/components/SyncDebugSection', () => ({
  SyncDebugSection: () => null,
}));
jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    EngineClient: {
      getInstance: () => ({
        getStats: () => ({ activityCount: 1 }),
        dashboardData: () => ({ pushRuns: [], requestBudget: mockRequestBudget() }),
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

async function openRequestBudget() {
  const screen = await render(<DebugScreen />);
  await act(async () => {});
  await fireEvent.press(screen.getByTestId('debug-section-request-budget'));
  await act(async () => {});
  return screen;
}

describe('the dashboard on the request budget', () => {
  beforeEach(() => {
    mockRequestBudget.mockReset();
    mockRequestBudget.mockImplementation(budget);
  });

  it('shows each intent against its allowance', async () => {
    const screen = await openRequestBudget();

    expect(screen.getByText('87 / 100')).toBeTruthy();
    expect(screen.getByText('230 / 600')).toBeTruthy();
    expect(screen.getByText('3 / 50')).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText('41')).toBeTruthy();
  });

  it('names the cooldown and the next reset', async () => {
    const screen = await openRequestBudget();

    expect(screen.getByText(new Date(COOLDOWN_UNTIL * 1000).toLocaleString())).toBeTruthy();
    expect(screen.getByText(new Date(NEXT_RESET * 1000).toLocaleString())).toBeTruthy();
  });

  it('says there is no cooldown rather than showing nothing', async () => {
    mockRequestBudget.mockReturnValueOnce({ ...budget(), cooldownUntil: undefined });

    const screen = await openRequestBudget();

    // The cooldown row and the pool hold row both read none.
    expect(screen.getAllByText('none')).toHaveLength(2);
  });

  it('shows the pool figure and its hold when a response carried the pair', async () => {
    mockRequestBudget.mockReturnValueOnce({
      ...budget(),
      poolRemainingFifteenMinutes: 300,
      poolRemainingDaily: 1_900,
      poolLimitFifteenMinutes: 2_500,
      poolLimitDaily: 8_000,
      poolSeenAt: COOLDOWN_UNTIL - 60,
      poolHoldUntil: NEXT_RESET,
    });

    const screen = await openRequestBudget();

    expect(screen.getByText('1900 / 8000')).toBeTruthy();
    expect(screen.getByText('300 / 2500')).toBeTruthy();
    expect(screen.getByText(new Date((COOLDOWN_UNTIL - 60) * 1000).toLocaleString())).toBeTruthy();
    expect(screen.getAllByText(new Date(NEXT_RESET * 1000).toLocaleString()).length).toBe(2);
  });

  it('says no pool figure was seen rather than showing nothing', async () => {
    const screen = await openRequestBudget();

    expect(screen.getByText('none seen this process')).toBeTruthy();
  });

  it('says so where the engine keeps no budget', async () => {
    mockRequestBudget.mockReturnValueOnce(undefined as never);

    const screen = await openRequestBudget();

    expect(screen.getByText('No request budget is kept in this build.')).toBeTruthy();
  });

  describe('the lifted backfill cap', () => {
    const keySession = (extra = {}) => ({
      ...budget(),
      signedInWith: 'apiKey',
      backfillCapLifted: false,
      ...extra,
    });
    const SWITCH = 'Lift the daily backfill cap';
    const WARNING = /may affect other users of Veloq using the API/;

    it('offers the switch with its warning on a personal-key session', async () => {
      mockRequestBudget.mockReturnValue(keySession() as never);

      const screen = await openRequestBudget();

      expect(screen.getByText('Signed in with')).toBeTruthy();
      expect(screen.getByText('personal key')).toBeTruthy();
      expect(screen.getByLabelText(SWITCH)).toBeTruthy();
      expect(screen.getByText(WARNING)).toBeTruthy();
    });

    it('shows the day row as lifted and keeps the warning on screen', async () => {
      mockRequestBudget.mockReturnValue(
        keySession({
          backfillCapLifted: true,
          backfillPerDay: undefined,
          backfillToday: 12,
        }) as never
      );

      const screen = await openRequestBudget();

      expect(screen.getByText('12 / no cap (lifted)')).toBeTruthy();
      expect(screen.getByText(WARNING)).toBeTruthy();
    });

    it('offers nothing on an OAuth session beyond naming it', async () => {
      mockRequestBudget.mockReturnValue(keySession({ signedInWith: 'oauth' }) as never);

      const screen = await openRequestBudget();

      expect(screen.getByText('OAuth')).toBeTruthy();
      expect(screen.queryByLabelText(SWITCH)).toBeNull();
      expect(screen.queryByText(WARNING)).toBeNull();
    });
  });

  describe('on the sign-in and the budget pair', () => {
    const signedInWith = (authMethod: 'oauth' | 'apiKey') =>
      useAuthStore.setState({ authMethod, isDemoMode: false, athleteId: 'i1' });

    it('names the key sign-in and says it sends no pair', async () => {
      signedInWith('apiKey');

      const screen = await openRequestBudget();

      expect(screen.getByText('settings.authApiKey')).toBeTruthy();
      expect(screen.getByText('never')).toBeTruthy();
      expect(
        screen.getByText(
          'The API key path sends no budget pair, so the budget hold does not apply.'
        )
      ).toBeTruthy();
    });

    it('names the OAuth sign-in and shows never while no pair has arrived', async () => {
      signedInWith('oauth');

      const screen = await openRequestBudget();

      expect(screen.getByText('settings.authOAuth')).toBeTruthy();
      expect(screen.getByText('never')).toBeTruthy();
      expect(screen.queryByText(/sends no budget pair/)).toBeNull();
    });

    it('counts the responses that carried the pair and shows the last one', async () => {
      signedInWith('oauth');
      mockRequestBudget.mockReturnValueOnce({
        ...budget(),
        pairResponses: 7,
        lastRemainingFifteenMinutes: 80,
        lastRemainingDaily: 900,
        lastPairAt: COOLDOWN_UNTIL,
      });

      const screen = await openRequestBudget();

      expect(
        screen.getByText(
          `7 responses, last 80 / 900 at ${new Date(COOLDOWN_UNTIL * 1000).toLocaleString()}`
        )
      ).toBeTruthy();
    });
  });
});
