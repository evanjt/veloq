/**
 * Scenario: an athlete who never finds the hold on a live tile opens recording
 * settings to choose which field each tile shows.
 *
 * Expected behaviour: each mode lists its tiles in order, a tile opens the same
 * field picker the live screen opens, and the choice is stored exactly as the
 * live screen stores it: the field lands in that tile, a field already shown
 * elsewhere swaps places, and a dismissed picker changes nothing.
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, renderHook, waitFor, within } from '@testing-library/react-native';

import RecordingSettingsScreen from '@/app/recording-settings';
import { answerSheet } from '../__shared__/answerSheet';
import { useSheetRequest } from '@/shared/app/sheetRequest';
import type { FieldPickerSheetInput } from '@/app/sheets/field-picker';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';

const STORAGE_KEY = 'veloq-recording-preferences';
const mockPush = jest.fn();
const mockParams: Record<string, string | undefined> = {};

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    back: jest.fn(),
    canGoBack: () => true,
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: { textSecondary: '#888' } }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('@/shared/app/navigation', () => ({
  navigateTo: jest.fn(),
  goBack: jest.requireActual('@/shared/app/navigation').goBack,
}));

async function storedFields(mode: string): Promise<string[] | undefined> {
  await act(async () => {});
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  return stored ? JSON.parse(stored).dataFields?.[mode] : undefined;
}

beforeEach(async () => {
  mockPush.mockClear();
  delete mockParams.request;
  await AsyncStorage.clear();
  useRecordingPreferences.setState({
    dataFields: {
      gps: ['speed', 'distance', 'heartrate', 'power'],
      indoor: ['heartrate', 'power', 'cadence', 'timer'],
    },
  });
});

describe('recording settings tile order', () => {
  it('lists every tile of each mode in order', async () => {
    const view = await render(<RecordingSettingsScreen />);
    const gps = ['speed', 'distance', 'heartrate', 'power'];
    gps.forEach((field, index) => {
      const row = view.getByTestId(`settings-tile-gps-${index}`);
      expect(within(row).getByText(`recording.fields.${field}`)).toBeTruthy();
    });
    expect(
      within(view.getByTestId('settings-tile-indoor-3')).getByText('recording.fields.timer')
    ).toBeTruthy();
  });

  it('opens the field picker on the tile with its current field', async () => {
    const view = await render(<RecordingSettingsScreen />);
    void fireEvent.press(view.getByTestId('settings-tile-gps-1'));
    const pushed = mockPush.mock.calls.at(-1)[0];
    expect(pushed.pathname).toBe('sheets/field-picker');
    mockParams.request = pushed.params.request;
    const sheet = await renderHook(() => useSheetRequest<FieldPickerSheetInput, string>());
    expect(sheet.result.current.input).toEqual({ selectedField: 'distance' });
    await sheet.unmount();
  });

  it('puts the chosen field in that tile and stores it', async () => {
    const view = await render(<RecordingSettingsScreen />);
    void fireEvent.press(view.getByTestId('settings-tile-gps-2'));
    await answerSheet(mockPush, mockParams, 'cadence');
    await waitFor(() =>
      expect(useRecordingPreferences.getState().dataFields.gps).toEqual([
        'speed',
        'distance',
        'cadence',
        'power',
      ])
    );
    expect(await storedFields('gps')).toEqual(['speed', 'distance', 'cadence', 'power']);
    expect(
      within(view.getByTestId('settings-tile-gps-2')).getByText('recording.fields.cadence')
    ).toBeTruthy();
  });

  it('swaps places with a field already shown in another tile', async () => {
    const view = await render(<RecordingSettingsScreen />);
    void fireEvent.press(view.getByTestId('settings-tile-gps-2'));
    await answerSheet(mockPush, mockParams, 'speed');
    await waitFor(() =>
      expect(useRecordingPreferences.getState().dataFields.gps).toEqual([
        'heartrate',
        'distance',
        'speed',
        'power',
      ])
    );
    expect(await storedFields('gps')).toEqual(['heartrate', 'distance', 'speed', 'power']);
  });

  it('leaves the other mode alone', async () => {
    const view = await render(<RecordingSettingsScreen />);
    void fireEvent.press(view.getByTestId('settings-tile-indoor-0'));
    await answerSheet(mockPush, mockParams, 'calories');
    await waitFor(() =>
      expect(useRecordingPreferences.getState().dataFields.indoor).toEqual([
        'calories',
        'power',
        'cadence',
        'timer',
      ])
    );
    expect(useRecordingPreferences.getState().dataFields.gps).toEqual([
      'speed',
      'distance',
      'heartrate',
      'power',
    ]);
  });

  it('changes nothing when the picker is dismissed', async () => {
    const view = await render(<RecordingSettingsScreen />);
    void fireEvent.press(view.getByTestId('settings-tile-gps-2'));
    await answerSheet(mockPush, mockParams, null);
    await act(async () => {});
    expect(useRecordingPreferences.getState().dataFields.gps).toEqual([
      'speed',
      'distance',
      'heartrate',
      'power',
    ]);
    expect(await storedFields('gps')).toBeUndefined();
  });

  it('lists the default tiles of a mode the stored layout never named', async () => {
    useRecordingPreferences.setState({ dataFields: { gps: ['speed'] } });
    const view = await render(<RecordingSettingsScreen />);
    ['heartrate', 'power', 'cadence', 'timer'].forEach((field, index) => {
      const row = view.getByTestId(`settings-tile-indoor-${index}`);
      expect(within(row).getByText(`recording.fields.${field}`)).toBeTruthy();
    });
  });

  it('stops adding fields at the cap and says how many are chosen', async () => {
    useRecordingPreferences.setState({
      dataFields: { gps: ['speed', 'distance', 'heartrate', 'power', 'cadence', 'timer'] },
    });
    const view = await render(<RecordingSettingsScreen />);
    expect(view.getByTestId('settings-field-count-gps')).toBeTruthy();
    expect(view.getByTestId('settings-field-gps-calories').props.accessibilityState.disabled).toBe(
      true
    );
    expect(view.getByTestId('settings-field-gps-speed').props.accessibilityState.disabled).toBe(
      false
    );
    void fireEvent.press(view.getByTestId('settings-field-gps-calories'));
    expect(useRecordingPreferences.getState().dataFields.gps).not.toContain('calories');
    void fireEvent.press(view.getByTestId('settings-field-gps-timer'));
    await waitFor(() =>
      expect(
        view.getByTestId('settings-field-gps-calories').props.accessibilityState.disabled
      ).toBe(false)
    );
  });
});
