/**
 * Scenario: the sync tools, which wipe and re-download the library, sat behind
 * a Sync tab in the athlete's Insights bar whenever debug mode was on.
 *
 * Expected behaviour: they live on the developer dashboard, the one place
 * developer tools are reached from.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import DebugScreen from '@/app/debug';

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useSegments: () => ['debug'],
}));
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
jest.mock('@/features/routes/components/SyncDebugSection', () => ({
  SyncDebugSection: () => {
    const { Text } = require('react-native');
    return <Text testID="sync-tools">sync tools</Text>;
  },
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

describe('the developer dashboard', () => {
  it('carries the sync tools', async () => {
    const { getByTestId } = await render(<DebugScreen />);

    expect(getByTestId('sync-tools')).toBeTruthy();
  });
});
