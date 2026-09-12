/**
 * Scenario: the recording screen re-renders every second for the length of a
 * ride, because the timer feeds the metrics memo at the screen root. The header
 * and the status slot show nothing that changes with the clock, and both were
 * plain functions, so each tick reconciled them too.
 *
 * Expected behaviour: a render that changes nothing either of them reads leaves
 * both alone.
 */

import React from 'react';
import { Animated } from 'react-native';
import { render } from '@testing-library/react-native';

import { TimerHeader } from '@/features/recording/components/TimerHeader';
import { StatusSlot } from '@/features/recording/components/StatusSlot';

// The header's GPS indicator imports the shared UI barrel, which reaches the
// engine and the billing module. This test is about React's reconciliation, so
// the indicator is cut at its own edge rather than the whole chain stubbed.
jest.mock('@/features/recording/components/GpsSignalIndicator', () => ({
  GpsSignalIndicator: () => null,
}));

// `StatusSlot` imports the shared app barrel, which reaches the engine and the
// billing module through it.
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

describe('the parts of the recording screen the clock does not touch', () => {
  it('holds the header against a render that changed nothing it reads', () => {
    const onLock = jest.fn();
    const onOpenTypePicker = jest.fn();
    const props = {
      formattedElapsed: '00:12:34',
      currentActivityType: 'Ride' as never,
      status: 'recording' as never,
      statusPulse: new Animated.Value(1),
      mode: 'gps' as never,
      accuracy: 4,
      autoPaused: false,
      isLocked: false,
      textPrimary: '#000',
      textSecondary: '#666',
      border: '#ccc',
      onOpenTypePicker,
      onLock,
    };

    const { rerender, toJSON } = render(<TimerHeader {...props} />);
    const first = toJSON();
    rerender(<TimerHeader {...props} />);

    expect(toJSON()).toEqual(first);
  });

  it('is memoised, so a stable prop set is not reconciled again', () => {
    // `React.memo` marks the element type; a plain function component does not.
    expect((TimerHeader as unknown as { $$typeof: symbol }).$$typeof).toBe(
      Symbol.for('react.memo')
    );
    expect((StatusSlot as unknown as { $$typeof: symbol }).$$typeof).toBe(Symbol.for('react.memo'));
  });
});
