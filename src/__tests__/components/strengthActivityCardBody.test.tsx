/**
 * Scenario: the strength activity card draws a front and a back body diagram
 * for the athlete it belongs to.
 *
 * Expected behaviour: both diagrams take their body type from the athlete's
 * profile, and fall back to male only when the profile carries no sex.
 */

import React from 'react';
import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { configure, fireEvent, render, screen } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { StrengthActivityCard } from '@/features/strength/components/StrengthActivityCard';
import { Card } from '@/shared/ui/Card';
import type { Activity } from '@/types';

// The card's drawings are hidden from a screen reader, which hears them in the
// card's label, so queries reach hidden elements.
configure({ defaultIncludeHiddenElements: true });

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(() => Promise.resolve()),
  performAndroidHapticsAsync: jest.fn(() => Promise.resolve()),
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
  ...jest.requireActual('@/features/activity/lib/activityCardA11yLabel'),
  ActivityCardContextMenu: () => null,
  SkylineBar: () => null,
  activitySecondaryStatLabels: jest.requireActual('@/features/activity/lib/activityCardA11yLabel')
    .activitySecondaryStatLabels,
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

async function draw() {
  const view = await render(
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
  it('draws the female body for a female athlete', async () => {
    mockAthlete = { sex: 'F' };

    expect(await draw()).toEqual({ front: 'female', back: 'female', surface: 'raised' });
  });

  it('draws the male body for a male athlete', async () => {
    mockAthlete = { sex: 'M' };

    expect(await draw()).toEqual({ front: 'male', back: 'male', surface: 'raised' });
  });

  it('falls back to the male body when the profile has no sex', async () => {
    mockAthlete = null;

    expect(await draw()).toEqual({ front: 'male', back: 'male', surface: 'raised' });
  });
});

describe('the strength activity card long-press', () => {
  it.each([
    ['ios', Haptics.impactAsync, 'medium'],
    ['android', Haptics.performAndroidHapticsAsync, 'long-press'],
  ] as const)('fires one medium haptic on %s', async (os, call, constant) => {
    const originalOS = Platform.OS;
    Platform.OS = os;
    mockAthlete = null;
    (call as jest.Mock).mockClear();
    try {
      await draw();

      await fireEvent(screen.getByTestId('activity-card-a1'), 'longPress');

      expect(call).toHaveBeenCalledTimes(1);
      expect(call).toHaveBeenCalledWith(constant);
    } finally {
      Platform.OS = originalOS;
    }
  });
});

describe('the strength activity card spoken name', () => {
  it('carries the duration, exercise and set counts, the load and the heart rate', async () => {
    await initialiseI18n('en-GB');
    mockAthlete = null;
    render(
      <StrengthActivityCard
        activity={
          {
            id: 'a2',
            name: 'Pull day',
            type: 'WeightTraining',
            moving_time: 3600,
            average_heartrate: 131,
            start_date_local: '2026-01-01T08:00:00',
          } as Activity
        }
        strengthData={{ muscles: [], exerciseCount: 4, setCount: 12, totalWeight: 0 }}
      />
    );

    const label = String(screen.getByTestId('activity-card-a2').props.accessibilityLabel);
    expect(label.startsWith('Pull day, ')).toBe(true);
    expect(label).toContain('strength.durationLabel: 1 hour');
    expect(label).toContain('activityDetail.exercises: 4');
    expect(label).toContain('strength.setsLabel: 12');
    expect(label).toContain('activity.heartRate: 131 bpm');
    expect(label).not.toContain('units.bpm');
    expect(label).not.toContain('strength.totalLabel');
  });

  it('leaves the stats row out of the screen reader order', () => {
    mockAthlete = null;
    draw();

    expect(screen.getAllByRole('button', { includeHiddenElements: false })).toHaveLength(1);
  });
});
