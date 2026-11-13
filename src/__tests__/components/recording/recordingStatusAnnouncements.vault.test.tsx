/**
 * Scenario: a rider with a screen reader has the phone mounted or pocketed, so
 * the recording screen's state changes reach them as speech or not at all.
 *
 * Expected behaviour: each change is spoken once, on iOS through an
 * announcement and on Android through a live region on the view that changed.
 * A lost signal or a dropped sensor interrupts, the rest wait their turn.
 */

import React from 'react';
import { AccessibilityInfo, Animated, Platform } from 'react-native';
import { render } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { TimerHeader } from '@/features/recording/components/TimerHeader';
import { StatusSlot } from '@/features/recording/components/StatusSlot';

jest.mock('@/features/recording/components/GpsSignalIndicator', () => ({
  GpsSignalIndicator: () => null,
}));
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

const announce = jest.mocked(AccessibilityInfo.announceForAccessibility);

const SLOT = {
  backgroundTrackingWarning: null,
  gpsWarning: null,
  sensorIssue: null,
  splitBanner: null,
  onDismissGpsWarning: () => {},
};

const HEADER = {
  currentActivityType: 'Ride' as never,
  status: 'recording' as const,
  statusPulse: new Animated.Value(1),
  mode: 'gps' as const,
  accuracy: 4,
  autoPaused: false,
  isLocked: false,
  textPrimary: '#000',
  textSecondary: '#666',
  border: '#ccc',
  onOpenTypePicker: () => {},
  onLock: () => {},
};

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

beforeEach(() => {
  announce.mockClear();
  Platform.OS = 'ios';
});

describe('the status slot speaks what it shows', () => {
  it('interrupts with a lost GPS signal, once', () => {
    const { getByTestId, rerender } = render(<StatusSlot {...SLOT} gpsWarning="GPS signal lost" />);
    rerender(<StatusSlot {...SLOT} gpsWarning="GPS signal lost" />);

    expect(announce.mock.calls).toEqual([['GPS signal lost']]);
    expect(getByTestId('status-slot-gps').props.accessibilityLiveRegion).toBe('assertive');
  });

  it('interrupts with a dropped sensor', () => {
    const { getByTestId } = render(<StatusSlot {...SLOT} sensorIssue="Heart rate lost" />);

    expect(announce.mock.calls).toEqual([['Heart rate lost']]);
    expect(getByTestId('status-slot-sensor').props.accessibilityLiveRegion).toBe('assertive');
  });

  it('speaks a split in words rather than its abbreviations, and politely', () => {
    const splitBanner = {
      text: 'km 3 · 5:12 /km',
      spoken: 'Kilometre 3, 5 minutes 12 seconds per kilometre',
    };
    const { getByTestId } = render(<StatusSlot {...SLOT} splitBanner={splitBanner} />);

    expect(announce.mock.calls).toEqual([['Kilometre 3, 5 minutes 12 seconds per kilometre']]);
    expect(getByTestId('status-slot-split').props.accessibilityLiveRegion).toBe('polite');
  });

  it('speaks the next message when a higher one replaces a split', () => {
    const splitBanner = { text: 'km 3 · 5:12 /km', spoken: 'Kilometre 3' };
    const { rerender } = render(<StatusSlot {...SLOT} splitBanner={splitBanner} />);
    rerender(<StatusSlot {...SLOT} splitBanner={splitBanner} gpsWarning="GPS signal lost" />);

    expect(announce.mock.calls).toEqual([['Kilometre 3'], ['GPS signal lost']]);
  });

  it('says nothing when there is nothing to show', () => {
    render(<StatusSlot {...SLOT} />);
    expect(announce).not.toHaveBeenCalled();
  });

  it('leaves speaking to the live region on Android', () => {
    Platform.OS = 'android';
    render(<StatusSlot {...SLOT} gpsWarning="GPS signal lost" />);
    expect(announce).not.toHaveBeenCalled();
  });
});

describe('the timer header speaks the recording state', () => {
  it('announces an auto-pause once', () => {
    const { getByTestId, rerender } = render(<TimerHeader {...HEADER} />);
    announce.mockClear();

    rerender(<TimerHeader {...HEADER} status="paused" autoPaused />);
    rerender(<TimerHeader {...HEADER} status="paused" autoPaused accuracy={8} />);

    expect(announce.mock.calls).toEqual([['Auto-paused. Waiting for movement']]);
    expect(getByTestId('recording-autopause').props.accessibilityLiveRegion).toBe('polite');
  });

  it('announces a manual pause and the resume after it', () => {
    const { getByTestId, rerender } = render(<TimerHeader {...HEADER} />);
    announce.mockClear();

    rerender(<TimerHeader {...HEADER} status="paused" />);
    rerender(<TimerHeader {...HEADER} status="recording" />);

    expect(announce.mock.calls).toEqual([['Paused'], ['Recording']]);
    expect(getByTestId('recording-status').props.accessibilityLiveRegion).toBe('polite');
  });

  it('says nothing on the screen waiting for Start', () => {
    render(<TimerHeader {...HEADER} status="idle" />);
    expect(announce).not.toHaveBeenCalled();
  });
});
