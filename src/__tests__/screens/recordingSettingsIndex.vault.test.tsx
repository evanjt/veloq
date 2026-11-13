/**
 * Scenario: recording settings was one long page of six groups.
 *
 * Expected behaviour: it is a short index. Sensors come first, every row states its current
 * value, and each row opens its own page.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import RecordingSettingsScreen from '@/app/recording-settings';
import { navigateTo } from '@/shared/app/navigation';
import { SCREEN_HEADERS } from '@/shared/app/screenHeaders';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';
import { useSensorStore } from '@/features/sensors/store';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: { textSecondary: '#888' } }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

const go = navigateTo as jest.MockedFunction<typeof navigateTo>;

const ROWS: [testID: string, route: string][] = [
  ['settings-sensors-link', '/sensor-settings'],
  ['settings-data-fields-link', '/recording-data-fields'],
  ['settings-gps-link', '/recording-gps-settings'],
  ['settings-auto-pause-link', '/recording-auto-pause'],
  ['settings-upload-link', '/recording-upload'],
  ['settings-units-link', '/display-settings'],
];

beforeEach(() => {
  go.mockClear();
  useRecordingPreferences.setState({
    autoPauseEnabled: true,
    autoPauseDurationMs: 3000,
    autoUploadEnabled: true,
    gpsAccuracyMode: 'high',
    keepAwakeEnabled: true,
  });
});

describe('recording settings index', () => {
  it('lists sensors first, then the other groups in order', async () => {
    const view = await render(<RecordingSettingsScreen />);
    const order = view.getAllByTestId(/^settings-.*-link$/).map((n) => n.props.testID);
    expect(order).toEqual(ROWS.map(([id]) => id));
  });

  it.each(ROWS)('%s opens its own page', async (testID, route) => {
    const view = await render(<RecordingSettingsScreen />);
    fireEvent.press(view.getByTestId(testID));
    expect(go).toHaveBeenCalledWith(route);
  });

  it('gives every row a summary of its current value', async () => {
    const view = await render(<RecordingSettingsScreen />);
    for (const [testID] of ROWS) {
      const label: string = view.getByTestId(testID).props.accessibilityLabel;
      expect(label.split(',').length).toBeGreaterThan(1);
    }
  });

  it('summarises the stored values and follows a change', async () => {
    useSensorStore.setState({ knownSensors: [{ id: 'a' } as never] });
    const view = await render(<RecordingSettingsScreen />);
    expect(view.getByTestId('settings-auto-pause-link').props.accessibilityLabel).toContain('3');
    expect(view.getByTestId('settings-sensors-link').props.accessibilityLabel).toContain(
      'pairedCount'
    );
    useSensorStore.setState({ knownSensors: [] });
    view.rerender(<RecordingSettingsScreen />);
    expect(view.getByTestId('settings-sensors-link').props.accessibilityLabel).toContain(
      'nonePairedShort'
    );
  });

  it('keeps the moved controls off the index', async () => {
    const view = await render(<RecordingSettingsScreen />);
    expect(view.queryByTestId('settings-auto-pause')).toBeNull();
    expect(view.queryByTestId('settings-auto-upload')).toBeNull();
    expect(view.queryByTestId('settings-gps-mode-high')).toBeNull();
    expect(view.queryByTestId('settings-recordings-link')).toBeNull();
  });

  it('gives each page a large-title header', () => {
    for (const route of [
      'recording-data-fields',
      'recording-gps-settings',
      'recording-auto-pause',
      'recording-upload',
    ]) {
      expect(SCREEN_HEADERS[route]?.largeTitle).toBe(true);
    }
  });
});
