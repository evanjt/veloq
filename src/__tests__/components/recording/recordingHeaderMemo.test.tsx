/**
 * Scenario: the recording screen updates from store changes while the clock
 * updates only the elapsed time within the header.
 *
 * Expected behaviour: a render that changes nothing either of them reads leaves
 * both alone.
 */

import React from 'react';
import { Animated } from 'react-native';
import { render } from '@testing-library/react-native';

import { TimerHeader } from '@/features/recording/components/TimerHeader';
import { StatusSlot } from '@/features/recording/components/StatusSlot';
import { selectStatusMessage } from '@/features/recording/lib/statusSlot';

// The header's GPS indicator imports the shared UI barrel, which reaches the
// engine and the billing module. This test is about React's reconciliation, so
// the indicator is cut at its own edge rather than the whole chain stubbed.
jest.mock('@/features/recording/lib/statusSlot', () => {
  const actual = jest.requireActual('@/features/recording/lib/statusSlot');
  return { ...actual, selectStatusMessage: jest.fn(actual.selectStatusMessage) };
});

const mockIndicatorRender = jest.fn();
jest.mock('@/features/recording/components/GpsSignalIndicator', () => ({
  GpsSignalIndicator: () => {
    mockIndicatorRender();
    return null;
  },
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

    mockIndicatorRender.mockClear();
    const { rerender } = render(<TimerHeader {...props} />);
    const rendersAfterMount = mockIndicatorRender.mock.calls.length;
    rerender(<TimerHeader {...props} />);

    expect(rendersAfterMount).toBeGreaterThan(0);
    expect(mockIndicatorRender.mock.calls.length).toBe(rendersAfterMount);
  });

  it('renders the header again when what it reads changes', () => {
    const props = {
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
      onOpenTypePicker: jest.fn(),
      onLock: jest.fn(),
    };
    mockIndicatorRender.mockClear();
    const { rerender } = render(<TimerHeader {...props} />);
    const rendersAfterMount = mockIndicatorRender.mock.calls.length;
    rerender(<TimerHeader {...props} accuracy={12} />);

    expect(mockIndicatorRender.mock.calls.length).toBeGreaterThan(rendersAfterMount);
  });

  it('holds the status slot against a render that changed nothing it reads', () => {
    const select = selectStatusMessage as jest.Mock;
    const props = {
      backgroundTrackingWarning: null,
      gpsWarning: 'Weak GPS',
      sensorIssue: null,
      splitBanner: null,
      onDismissGpsWarning: jest.fn(),
    };
    select.mockClear();
    const { rerender } = render(<StatusSlot {...props} />);
    const rendersAfterMount = select.mock.calls.length;
    rerender(<StatusSlot {...props} />);
    expect(select.mock.calls.length).toBe(rendersAfterMount);

    rerender(<StatusSlot {...props} gpsWarning="Lost GPS" />);
    expect(select.mock.calls.length).toBeGreaterThan(rendersAfterMount);
  });
});
