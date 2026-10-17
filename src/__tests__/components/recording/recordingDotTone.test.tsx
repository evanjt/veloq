/**
 * Scenario: the REC dot is the one mark on the recording screen that says a
 * ride is being recorded, and the record role is the colour every other
 * recording surface wears.
 *
 * Expected behaviour: while recording the dot is the theme's `recording` tone,
 * never the error red, and paused keeps the warning mark.
 */

import React from 'react';
import { Animated, StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { TimerHeader } from '@/features/recording/components/TimerHeader';
import { colors, recording } from '@/theme';
import { initialiseI18n } from '@/i18n';

let mockIsDark = false;
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: mockIsDark }),
}));
jest.mock('@/features/recording/components/GpsSignalIndicator', () => ({
  GpsSignalIndicator: () => null,
}));
jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides({}));
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

const props = {
  currentActivityType: 'Ride' as never,
  statusPulse: new Animated.Value(1),
  mode: 'gps' as never,
  accuracy: 4,
  autoPaused: false,
  isLocked: false,
  textPrimary: '#000',
  textSecondary: '#666',
  border: '#ccc',
  onOpenTypePicker: () => {},
  onLock: () => {},
};

function dotColour(): string {
  return StyleSheet.flatten(screen.getByTestId('recording-status-dot').props.style)
    .backgroundColor as string;
}

describe('the REC dot', () => {
  it.each(['light', 'dark'] as const)(
    'wears the %s recording tone while recording',
    async (theme) => {
      mockIsDark = theme === 'dark';
      await render(<TimerHeader {...props} status={'recording' as never} />);

      expect(dotColour()).toBe(recording[theme]);
      expect(dotColour()).not.toBe(colors.error);
    }
  );

  it.each(['light', 'dark'] as const)(
    'keeps the warning mark while paused in %s',
    async (theme) => {
      mockIsDark = theme === 'dark';
      await render(<TimerHeader {...props} status={'paused' as never} />);

      expect(dotColour()).toBe(colors.warning);
    }
  );
});
