/**
 * Scenario: the lifted-cap switch on the Developer Dashboard writes the setting
 * through the sync namespace the barrel exports, and the SyncManager it reaches
 * holds the flag, so the switch reads what the engine kept after the refresh.
 *
 * Expected behaviour: one call to SyncManager.setBackfillCapLifted per toggle,
 * the switch stays where the engine left it, and a refusal is shown on screen.
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

// The sync tools read the activity cache and have a test of their own.
jest.mock('@/features/routes/components/SyncDebugSection', () => ({
  SyncDebugSection: () => null,
}));

const mockEngine = { backfillCapLifted: false };
const mockSetBackfillCapLifted = jest.fn((lifted: boolean) => {
  mockEngine.backfillCapLifted = lifted;
});
const mockSyncManager = {
  setBackfillCapLifted: mockSetBackfillCapLifted,
  getSyncStatus: () => undefined,
};

const requestBudget = () => ({
  userToday: 41,
  syncToday: 12,
  backfillToday: 230,
  backfillPerDay: 600,
  backfillLastFifteenMinutes: 87,
  backfillPerFifteenMinutes: 100,
  syncLastFifteenMinutes: 3,
  syncPerFifteenMinutes: 50,
  cooldownUntil: undefined,
  poolRemainingFifteenMinutes: undefined,
  poolRemainingDaily: undefined,
  poolLimitFifteenMinutes: undefined,
  poolLimitDaily: undefined,
  poolSeenAt: undefined,
  poolHoldUntil: undefined,
  nextReset: 1_772_670_600,
  pairResponses: 0,
  lastRemainingFifteenMinutes: undefined,
  lastRemainingDaily: undefined,
  lastPairAt: undefined,
  backfillCapLifted: mockEngine.backfillCapLifted,
  signedInWith: 'apiKey',
});

// The barrel's `sync` namespace over a host whose engine is this SyncManager, so
// the switch reaches the delegate that calls it, and nothing stands in for it.
jest.mock('veloqrs', () => {
  const { bindDelegates } = require('../../../modules/veloqrs/src/delegates/bind');
  const syncDelegates = require('../../../modules/veloqrs/src/delegates/sync');
  const host = {
    ready: true,
    engine: { sync: () => mockSyncManager },
    write: (_name: string, run: () => void) => run(),
    timed: (_name: string, run: () => unknown) => run(),
  };
  return require('../__shared__/veloqrsStub').withOverrides({
    EngineClient: {
      getInstance: () => ({
        getStats: () => ({ activityCount: 1 }),
        dashboardData: () => ({ pushRuns: [], requestBudget: requestBudget() }),
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
    sync: bindDelegates(host, syncDelegates),
  });
});

const SWITCH = 'Lift the daily backfill cap';

async function openRequestBudget() {
  const screen = await render(<DebugScreen />);
  await act(async () => {});
  await fireEvent.press(screen.getByTestId('debug-section-request-budget'));
  await act(async () => {});
  return screen;
}

const switchOn = (screen: Awaited<ReturnType<typeof openRequestBudget>>, checked: boolean) =>
  screen.getByRole('switch', { name: SWITCH, checked });

describe('the lifted backfill cap switch', () => {
  beforeEach(() => {
    mockEngine.backfillCapLifted = false;
    mockSetBackfillCapLifted.mockClear();
  });

  it('calls SyncManager once and keeps the switch on after the refresh', async () => {
    const screen = await openRequestBudget();

    await fireEvent.press(screen.getByLabelText(SWITCH));
    await act(async () => {});

    expect(mockSetBackfillCapLifted).toHaveBeenCalledTimes(1);
    expect(mockSetBackfillCapLifted).toHaveBeenCalledWith(true);
    expect(switchOn(screen, true)).toBeTruthy();
  });

  it('calls SyncManager once and keeps the switch off after the refresh', async () => {
    mockEngine.backfillCapLifted = true;
    const screen = await openRequestBudget();

    await fireEvent.press(screen.getByLabelText(SWITCH));
    await act(async () => {});

    expect(mockSetBackfillCapLifted).toHaveBeenCalledTimes(1);
    expect(mockSetBackfillCapLifted).toHaveBeenCalledWith(false);
    expect(switchOn(screen, false)).toBeTruthy();
  });

  it('shows the engine error when the write is refused', async () => {
    mockSetBackfillCapLifted.mockImplementationOnce(() => {
      throw new Error('refused');
    });
    const screen = await openRequestBudget();

    await fireEvent.press(screen.getByLabelText(SWITCH));

    expect(screen.getByTestId('debug-backfill-cap-error')).toBeTruthy();
    expect(switchOn(screen, false)).toBeTruthy();
  });
});
