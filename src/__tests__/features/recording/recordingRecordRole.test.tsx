/**
 * Scenario: a ride is being recorded, in either theme. The live track on the recording map and
 * the return pill shown elsewhere in the app are both recording surfaces.
 *
 * Expected behaviour: both draw in the record role for the active theme, never the teal brand
 * colour or the blue action colour. A paused ride keeps the warning mark on the pill.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { recordingMapLayers } from '@/features/recording/components/RecordingMap';
import { RecordingReturnPill } from '@/features/recording/components/RecordingReturnPill';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import { brand, colors, darkColors, recording } from '@/theme';

let mockIsDark = false;

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useTheme: () => ({ isDark: mockIsDark }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  usePathname: () => '/',
}));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

const themes = [
  ['light', false],
  ['dark', true],
] as const;

describe('the recording map live track', () => {
  it.each(themes)('draws in the record role in the %s theme', (tone, isDark) => {
    const line = recordingMapLayers(isDark).find((l) => l.id === 'recording-route-line');

    expect(line?.paint?.['line-color']).toBe(recording[tone]);
    expect(line?.paint?.['line-color']).not.toBe(brand.blue600);
  });
});

describe('the recording return pill', () => {
  beforeEach(() => {
    useRecordingStore.getState().reset();
    useAuthStore.setState({ athleteId: 'i1', isAuthenticated: true });
    useRecordingStore.getState().startRecording('Ride', 'gps');
  });

  afterEach(() => {
    mockIsDark = false;
  });

  function labelColour(view: Awaited<ReturnType<typeof render>>, key: string) {
    return StyleSheet.flatten(view.getByText(key).props.style).color;
  }

  it.each(themes)('reads the record role while recording in the %s theme', async (tone, isDark) => {
    mockIsDark = isDark;
    const view = await render(<RecordingReturnPill />);

    const accent = labelColour(view, 'recording.status.recording');
    expect(accent).toBe(recording[tone]);
    expect(accent).not.toBe(brand.blue);
    expect(accent).not.toBe((isDark ? darkColors : colors).actionPrimary);
  });

  it.each(themes)('keeps the warning mark while paused in the %s theme', async (_tone, isDark) => {
    mockIsDark = isDark;
    useRecordingStore.getState().pauseRecording();
    const view = await render(<RecordingReturnPill />);

    expect(labelColour(view, 'recording.status.paused')).toBe(
      (isDark ? darkColors : colors).warningText
    );
  });
});
