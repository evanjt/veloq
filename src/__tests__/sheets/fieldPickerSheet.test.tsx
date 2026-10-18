/**
 * Scenario: the recording data field picker is a formSheet route that answers its caller through
 * the sheet request channel.
 *
 * Expected behaviour: it lists every field, a tapped field resolves the caller with it and
 * dismisses, the current field reads as selected, and closing without a tap cancels. The
 * calories row says how the estimate is made, and says so when it assumes a weight.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import FieldPickerSheet, { type FieldPickerSheetInput } from '@/app/sheets/field-picker';
import { ALL_DATA_FIELDS } from '@/features/recording';
import { openSheet } from '@/shared/app/sheetRequest';
import { useAuthStore } from '@/shared/app/AuthStore';
import { sheetScrollPlacement } from '../__shared__/sheetScrollPlacement';
import type { DataFieldType } from '@/types';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: { request?: string } = {};

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    canGoBack: () => true,
    back: () => mockBack(),
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/features/recording', () =>
  require('../__shared__/recordingBarrelStub').withRecordingOverrides()
);

async function open(selectedField: DataFieldType | null) {
  const result = openSheet<FieldPickerSheetInput, DataFieldType>('sheets/field-picker', {
    selectedField,
  });
  mockParams = { request: mockPush.mock.calls.at(-1)[0].params.request };
  await render(<FieldPickerSheet />);
  return { result };
}

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
});

describe('field picker sheet', () => {
  it('lists every field and resolves the caller with the tapped one', async () => {
    const { result } = await open('speed');
    expect(screen.getByTestId('field-picker-list').props.data).toEqual(ALL_DATA_FIELDS);
    await fireEvent.press(screen.getByTestId('field-option-cadence'));
    await expect(result).resolves.toEqual({ kind: 'selected', value: 'cadence' });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('marks the current field as selected', async () => {
    await open('power');
    expect(screen.getByTestId('field-option-power').props.accessibilityState).toMatchObject({
      selected: true,
    });
    expect(screen.getByTestId('field-option-speed').props.accessibilityState).toMatchObject({
      selected: false,
    });
  });

  it('keeps its scroll view where the iOS sheet sizes it', async () => {
    await open(null);
    expect(sheetScrollPlacement(screen.toJSON())).not.toBe('nested');
  });

  it('resolves cancelled when it unmounts without a tap', async () => {
    const { result } = await open(null);
    await screen.unmount();
    await expect(result).resolves.toEqual({ kind: 'cancelled' });
  });

  it('notes the calories method, and the assumed weight only when the profile has none', async () => {
    const athlete = useAuthStore.getState().athlete;
    useAuthStore.setState({ athlete: null });
    await open(null);
    const row = screen.getByTestId('field-option-calories');
    expect(row).toHaveTextContent(/recording\.caloriesMethod/);
    expect(row).toHaveTextContent(/recording\.caloriesDefaultWeight:\{"weight":70\}/);
    expect(screen.getByTestId('field-option-distance')).not.toHaveTextContent(
      /recording\.caloriesMethod/
    );
    await screen.unmount();

    useAuthStore.setState({ athlete: { id: 'i1', name: 'Rider', weightKg: 64 } });
    await open(null);
    expect(screen.getByTestId('field-option-calories')).toHaveTextContent(
      /recording\.caloriesMethod/
    );
    expect(screen.getByTestId('field-option-calories')).not.toHaveTextContent(
      /caloriesDefaultWeight/
    );
    useAuthStore.setState({ athlete });
  });
});
