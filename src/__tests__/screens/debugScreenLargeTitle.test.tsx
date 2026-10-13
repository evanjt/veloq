/**
 * Scenario: on iOS 26 the developer dashboard's refresh control stopped its large title tracking
 * the scroll view, so the list scrolled under a title that never collapsed.
 *
 * Expected behaviour: it keeps the small title, and rendered on iOS its scroll view keeps the
 * refresh control and its own bottom spacing, with nothing added for a tab bar that does not draw
 * on a stack screen.
 */

import React from 'react';
import { Platform, RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import DebugScreen from '@/app/debug';
import { headerLargeTitle } from '@/shared/app/screenHeaders';
import { spacing } from '@/theme';

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

describe('developer dashboard scroll view', () => {
  it('keeps the small title on every platform', () => {
    expect(headerLargeTitle('debug', 'ios')).toBe(false);
    expect(headerLargeTitle('debug', 'android')).toBe(false);
  });

  it('keeps the refresh control and pads nothing for a tab bar', async () => {
    Platform.OS = 'ios';
    const { UNSAFE_getAllByType, UNSAFE_getByType } = await render(<DebugScreen />);

    const scroll = UNSAFE_getAllByType(ScrollView)[0];
    expect(scroll.props.contentInsetAdjustmentBehavior).toBe('automatic');
    expect(scroll.props.refreshControl.type).toBe(RefreshControl);
    expect(UNSAFE_getByType(RefreshControl)).toBeTruthy();
    expect(StyleSheet.flatten(scroll.props.contentContainerStyle).paddingBottom).toBe(spacing.md);
  });
});
