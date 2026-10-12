/**
 * Scenario: a GPS ride starts and the location request is refused. The ride
 * pauses and the status slot says why.
 *
 * Expected behaviour: the warning carries the settings action, the slot draws
 * it beside the close button, and a plain signal warning carries none.
 */

import React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render, renderHook } from '@testing-library/react-native';

import { useGpsSessionEffect } from '@/features/recording/hooks/useGpsSessionEffect';
import { useRecordingScreenState } from '@/features/recording/hooks/useRecordingScreenState';
import { StatusSlot } from '@/features/recording/components/StatusSlot';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/features/recording/lib/recordingSession', () => ({
  ensureLocationWatch: jest.fn().mockResolvedValue(undefined),
}));

function useRefusedGpsRide() {
  const screen = useRecordingScreenState();
  const status = useRecordingStore((s) => s.status);
  useGpsSessionEffect({
    mode: 'gps',
    status,
    hasPermission: false,
    precision: 'precise',
    requestPermission: async () => false,
    upgradePrecision: async () => {},
    setGpsWarning: screen.setGpsWarning,
  });
  return screen;
}

beforeEach(() => {
  useRecordingStore.getState().reset();
  useRecordingStore.getState().startRecording('Ride', 'gps');
});

it('pauses the ride and offers the settings page from the status slot', async () => {
  const { result } = await renderHook(() => useRefusedGpsRide());
  await act(async () => {
    await Promise.resolve();
  });

  expect(result.current.gpsWarning).toBe('recording.gpsPermissionDenied');
  expect(result.current.gpsWarningOpensSettings).toBe(true);
  expect(useRecordingStore.getState().status).toBe('paused');

  const openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  const slot = await render(
    <StatusSlot
      backgroundTrackingWarning={null}
      gpsWarning={result.current.gpsWarning}
      gpsWarningOpensSettings={result.current.gpsWarningOpensSettings}
      sensorIssue={null}
      splitBanner={null}
      onDismissGpsWarning={jest.fn()}
    />
  );
  await fireEvent.press(slot.getByText('common.openSettings'));
  expect(openSettings).toHaveBeenCalledTimes(1);
  openSettings.mockRestore();
});

it('drops the settings action when a later warning replaces the refusal', async () => {
  const { result } = await renderHook(() => useRecordingScreenState());
  await act(() => result.current.setGpsWarning('denied', { opensSettings: true }));
  await act(() => result.current.setGpsWarning('weak'));

  expect(result.current.gpsWarningOpensSettings).toBe(false);
  const slot = await render(
    <StatusSlot
      backgroundTrackingWarning={null}
      gpsWarning={result.current.gpsWarning}
      gpsWarningOpensSettings={result.current.gpsWarningOpensSettings}
      sensorIssue={null}
      splitBanner={null}
      onDismissGpsWarning={jest.fn()}
    />
  );
  expect(slot.queryByText('common.openSettings')).toBeNull();
});
