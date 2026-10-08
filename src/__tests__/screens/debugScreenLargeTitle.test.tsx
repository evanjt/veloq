/**
 * Scenario: the developer dashboard takes a collapsing large title on iOS, and its pull to refresh
 * sits against that title.
 *
 * Expected behaviour: it sets `largeTitle`, and rendered on iOS its scroll view lets the system
 * inset its content while keeping the refresh control and the tab bar clearance.
 */

import React from 'react';
import { Platform, RefreshControl, ScrollView, StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import DebugScreen from '@/app/debug';
import { headerLargeTitle } from '@/shared/app/screenHeaders';
import { TAB_BAR_SAFE_PADDING } from '@/shared/ui';

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
jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    EngineClient: {
      getInstance: () => ({
        getStats: () => ({ activityCount: 1 }),
        pushRuns: () => [],
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
  it('takes a large title on iOS', () => {
    expect(headerLargeTitle('debug', 'ios')).toBe(true);
    expect(headerLargeTitle('debug', 'android')).toBe(false);
  });

  it('insets the system way and keeps the refresh control and tab bar clearance', () => {
    Platform.OS = 'ios';
    const { UNSAFE_getAllByType, UNSAFE_getByType } = render(<DebugScreen />);

    const scroll = UNSAFE_getAllByType(ScrollView)[0];
    expect(scroll.props.contentInsetAdjustmentBehavior).toBe('automatic');
    expect(scroll.props.refreshControl.type).toBe(RefreshControl);
    expect(UNSAFE_getByType(RefreshControl)).toBeTruthy();
    expect(
      StyleSheet.flatten(scroll.props.contentContainerStyle).paddingBottom
    ).toBeGreaterThanOrEqual(TAB_BAR_SAFE_PADDING);
  });
});
