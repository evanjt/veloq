/**
 * Scenario: a screen reader user reaches a strength card in the feed. The menu
 * its hold opens was announced nowhere, and its stats row was a second button.
 * Expected behaviour: the card is one button whose hold action opens the menu.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { StrengthActivityCard } from '@/features/strength/components/StrengthActivityCard';
import type { Activity } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Medium: 'medium' },
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
    ActivityCardContextMenu: ({ visible }: { visible: boolean }) =>
      visible ? <Text testID="card-menu">menu</Text> : null,
    SkylineBar: () => null,
  };
});
jest.mock('react-native-body-highlighter', () => ({
  ...jest.requireActual('react-native-body-highlighter'),
  __esModule: true,
  default: () => null,
}));

const lift = {
  id: 'a1',
  name: 'Legs',
  type: 'WeightTraining',
  moving_time: 3600,
  average_heartrate: 120,
  start_date_local: '2026-01-01T08:00:00',
} as Activity;

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
