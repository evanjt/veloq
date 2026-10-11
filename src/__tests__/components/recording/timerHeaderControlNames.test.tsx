/**
 * Scenario: a screen reader user on the recording screen meets the sport badge,
 * drawn as a glyph and a sport name.
 * Expected behaviour: the badge says that pressing it changes the sport.
 */

import React from 'react';
import { Animated } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { TimerHeader } from '@/features/recording/components/TimerHeader';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

jest.mock('@/features/recording/components/GpsSignalIndicator', () => ({
  GpsSignalIndicator: () => null,
}));

// The close button imports the shared app barrel, which reaches the engine and
// the billing module through it.
jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides({}));
jest.mock('react-native-iap', () => ({
  useIAP: () => ({
    connected: false,
    products: [],
    fetchProducts: jest.fn(),
    requestPurchase: jest.fn(),
    finishTransaction: jest.fn(),
  }),
  ErrorCode: { UserCancelled: 'user-cancelled' },
}));

function drawHeader() {
  render(
    <TimerHeader
      currentActivityType={'Ride' as never}
      status={'recording' as never}
      statusPulse={new Animated.Value(1)}
      mode={'gps' as never}
      accuracy={4}
      autoPaused={false}
      isLocked={false}
      textPrimary="#000"
      textSecondary="#666"
      border="#ccc"
      onOpenTypePicker={jest.fn()}
      onLock={jest.fn()}
    />
  );
}

describe('the recording sport badge', () => {
  it('tells a screen reader the sport badge changes the sport', () => {
    drawHeader();

    expect(screen.getByTestId('recording-type-badge').props.accessibilityHint).toBe(
      'recording.changeType'
    );
  });
});
