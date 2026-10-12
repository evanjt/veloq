/**
 * Scenario: the recording header prints the abbreviation REC while recording,
 * which a screen reader spells out or reads as a word it does not know.
 *
 * Expected behaviour: the badge is named "Recording" while the screen still
 * prints the short form.
 */

import React from 'react';
import { Animated } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { TimerHeader } from '@/features/recording/components/TimerHeader';
import { initialiseI18n } from '@/i18n';

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

describe('the recording status badge', () => {
  it('is named Recording while the screen prints REC', async () => {
    await render(<TimerHeader {...props} status={'recording' as never} />);

    const badge = screen.getByText('REC');
    expect(badge.props.accessibilityLabel).toBe('Recording');
  });

  it('keeps the paused word as it reads', async () => {
    await render(<TimerHeader {...props} status={'paused' as never} />);

    expect(screen.queryByLabelText('Recording')).toBeNull();
  });
});
