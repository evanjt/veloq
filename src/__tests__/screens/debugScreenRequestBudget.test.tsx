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
  nextReset: NEXT_RESET,
});

const mockRequestBudget = jest.fn(budget);

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
  const screen = render(<DebugScreen />);
  await act(async () => {});
  fireEvent.press(screen.getByTestId('debug-section-request-budget'));
  await act(async () => {});
  return screen;
}

describe('the dashboard on the request budget', () => {
  beforeEach(() => {
    mockRequestBudget.mockClear();
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

    expect(screen.getByText('none')).toBeTruthy();
  });

  it('says so where the engine keeps no budget', async () => {
    mockRequestBudget.mockReturnValueOnce(undefined as never);

    const screen = await openRequestBudget();

    expect(screen.getByText('No request budget is kept in this build.')).toBeTruthy();
  });
});
