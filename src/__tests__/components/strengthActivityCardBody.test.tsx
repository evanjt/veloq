/**
 * Scenario: the strength activity card draws a front and a back body diagram
 * for the athlete it belongs to.
 *
 * Expected behaviour: both diagrams take their body type from the athlete's
 * profile, and fall back to male only when the profile carries no sex.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { StrengthActivityCard } from '@/features/strength/components/StrengthActivityCard';
import { Card } from '@/shared/ui/Card';
import type { Activity } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Medium: 'medium' },
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn() },
}));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));

let mockAthlete: { sex?: string } | null = null;
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
  useAthlete: () => ({ data: mockAthlete }),
}));

jest.mock('@/features/activity', () => ({
  ActivityCardContextMenu: () => null,
  SkylineBar: () => null,
}));

jest.mock('react-native-body-highlighter', () => {
  const { Text } = require('react-native');
  return {
    ...jest.requireActual('react-native-body-highlighter'),
    __esModule: true,
    default: ({ gender, side }: { gender: string; side: string }) => (
      <Text testID={`body-${side}`}>{gender}</Text>
    ),
  };
});

function draw() {
  const view = render(
    <StrengthActivityCard
      activity={
        {
          id: 'a1',
          name: 'Legs',
          type: 'WeightTraining',
          moving_time: 3600,
          start_date_local: '2026-01-01T08:00:00',
        } as Activity
      }
      strengthData={{ muscles: [], exerciseCount: 3, setCount: 9, totalWeight: 0 }}
    />
  );
  return {
    front: screen.getByTestId('body-front').props.children,
    back: screen.getByTestId('body-back').props.children,
    surface: view.UNSAFE_queryByType(Card)?.props.variant,
  };
}

describe('the strength activity card body diagrams', () => {
  it('draws the female body for a female athlete', () => {
    mockAthlete = { sex: 'F' };

    expect(draw()).toEqual({ front: 'female', back: 'female', surface: 'raised' });
  });

  it('draws the male body for a male athlete', () => {
    mockAthlete = { sex: 'M' };

    expect(draw()).toEqual({ front: 'male', back: 'male', surface: 'raised' });
  });

  it('falls back to the male body when the profile has no sex', () => {
    mockAthlete = null;

    expect(draw()).toEqual({ front: 'male', back: 'male', surface: 'raised' });
  });
});
