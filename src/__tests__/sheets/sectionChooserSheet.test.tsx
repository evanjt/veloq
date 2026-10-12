/**
 * Scenario: a tap where several sections overlap on the map opens a chooser,
 * a formSheet route that answers its caller through the sheet request channel.
 *
 * Expected behaviour: it lists each section it was given with its distance, a
 * tapped row resolves the caller with that section's id, and its Cancel or
 * closing without a tap cancels.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import SectionChooserSheet, { type SectionChooserInput } from '@/app/sheets/section-chooser';
import { openSheet } from '@/shared/app/sheetRequest';
import { initialiseI18n, i18n } from '@/i18n';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: { request?: string } = {};

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    canGoBack: () => true,
    back: () => mockBack(),
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));

const INPUT: SectionChooserInput = {
  sections: [
    { id: 'ridge', name: 'Ridge Road', distanceMeters: 1200 },
    { id: 'canal', name: 'Canal Path', distanceMeters: 850 },
  ],
};

async function open() {
  const result = openSheet<SectionChooserInput, string>('sheets/section-chooser', INPUT);
  mockParams = { request: mockPush.mock.calls.at(-1)[0].params.request };
  await render(<SectionChooserSheet />);
  return { result };
}

beforeAll(async () => {
  await initialiseI18n('en-GB');
});
beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
});

describe('section chooser sheet', () => {
  it('lists each section with its distance under its own title', async () => {
    await open();
    expect(screen.getByRole('header')).toHaveTextContent(i18n.t('maps.chooseSection'));
    expect(screen.getByTestId('section-choice-ridge')).toHaveTextContent(/Ridge Road.*1\.2 km/);
    expect(screen.getByTestId('section-choice-canal')).toHaveTextContent(/Canal Path.*850 m/);
  });

  it('resolves the caller with the id of the tapped section', async () => {
    const { result } = await open();
    await fireEvent.press(screen.getByTestId('section-choice-canal'));
    await expect(result).resolves.toEqual({ kind: 'selected', value: 'canal' });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('goes back from the Cancel in its title row and resolves cancelled as it closes', async () => {
    const { result } = await open();
    await fireEvent.press(screen.getByTestId('section-chooser-cancel'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    await screen.unmount();
    await expect(result).resolves.toEqual({ kind: 'cancelled' });
  });

  it('resolves cancelled when it closes without a tap', async () => {
    const { result } = await open();
    await screen.unmount();
    await expect(result).resolves.toEqual({ kind: 'cancelled' });
  });
});
