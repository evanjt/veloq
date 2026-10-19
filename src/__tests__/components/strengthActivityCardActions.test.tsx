/**
 * Scenario: a screen reader user reaches a strength card in the feed. The menu
 * its hold opens was announced nowhere, and its stats row was a second button.
 * Expected behaviour: the card is one button whose hold action opens the menu.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { StrengthActivityCard } from '@/features/strength/components/StrengthActivityCard';
import * as haptics from '@/shared/ui/haptics';
import type { FeedCard } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Medium: 'medium' },
}));
jest.mock('@/shared/ui/haptics', () => ({
  ...jest.requireActual('@/shared/ui/haptics'),
  light: jest.fn(),
  medium: jest.fn(),
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
  useAthlete: () => ({ data: null }),
}));
jest.mock('@/features/activity', () => {
  const { Text } = require('react-native');
  return {
    ...jest.requireActual('@/features/activity/lib/activityCardA11yLabel'),
    ActivityCardContextMenu: ({
      visible,
      children,
    }: {
      visible: boolean;
      children: React.ReactNode;
    }) => (
      <>
        {children}
        {visible ? <Text testID="card-menu">menu</Text> : null}
      </>
    ),
    SkylineBar: () => null,
  };
});

const lift = {
  id: 'a1',
  name: 'Legs',
  sportType: 'WeightTraining',
  movingTime: 3600,
  avgHr: 120,
  startDateLocal: '2026-01-01T08:00:00',
} as FeedCard;

beforeEach(() => {
  jest.mocked(haptics.light).mockClear();
  jest.mocked(haptics.medium).mockClear();
});

it('is one button whose hold action opens the menu', () => {
  render(
    <StrengthActivityCard
      activity={lift}
      strengthData={{ muscles: [], exerciseCount: 3, setCount: 9, totalWeight: 0 }}
    />
  );

  const buttons = screen.getAllByRole('button');
  expect(buttons).toHaveLength(1);
  expect(buttons[0].props.accessibilityActions).toEqual([
    { name: 'longpress', label: 'activity.moreActions' },
  ]);
  expect(screen.queryByTestId('card-menu')).toBeNull();

  fireEvent(buttons[0], 'accessibilityAction', { nativeEvent: { actionName: 'longpress' } });
  expect(screen.getByTestId('card-menu')).toBeTruthy();
});

it('opens the menu with no haptic of its own, leaving the open to the menu', () => {
  render(
    <StrengthActivityCard
      activity={lift}
      strengthData={{ muscles: [], exerciseCount: 3, setCount: 9, totalWeight: 0 }}
    />
  );

  fireEvent(screen.getByRole('button'), 'accessibilityAction', {
    nativeEvent: { actionName: 'longpress' },
  });
  expect(screen.getByTestId('card-menu')).toBeTruthy();
  expect(haptics.medium).not.toHaveBeenCalled();
  expect(haptics.light).not.toHaveBeenCalled();
});
