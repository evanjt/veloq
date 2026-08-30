/**
 * Scenario: managing the names a user typed onto sections.
 * Expected behaviour: every name is listed, a dormant one says so, and a name
 * only goes away after the user confirms.
 */

import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import NamedCorridorsScreen from '@/app/named-corridors';
import { useNamedCorridors } from '@/features/routes/hooks/useNamedCorridors';

jest.mock('@/features/routes/hooks/useNamedCorridors', () => ({
  useNamedCorridors: jest.fn(),
}));

jest.mock('@/features/routes/lib/sectionDisplayNames', () => ({
  getAllSectionDisplayNames: () => ({ 'sec-1': 'Section 4' }),
}));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...args: unknown[]) => mockPush(...args), back: jest.fn() },
}));

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaProvider: View,
    SafeAreaView: View,
  };
});

const remove = jest.fn(() => true);

function withCorridors(corridors: unknown[]) {
  (useNamedCorridors as jest.Mock).mockReturnValue({ corridors, remove });
}

const RESOLVED = {
  intentId: 'intent-1',
  name: 'The river climb',
  footprint: [
    { latitude: 46.5, longitude: 7.1 },
    { latitude: 46.6, longitude: 7.2 },
  ],
  sportType: 'Ride',
  createdAt: '2026-08-01 09:00:00',
  sectionId: 'sec-1',
  coverage: 0.82,
  primary: true,
  dormant: false,
};

const DORMANT = {
  ...RESOLVED,
  intentId: 'intent-2',
  name: 'Back lane',
  sectionId: undefined,
  coverage: 0,
  primary: false,
  dormant: true,
};

describe('NamedCorridorsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    remove.mockReturnValue(true);
  });

  it('says so when the user has named nothing', () => {
    withCorridors([]);
    const { getByTestId, queryByTestId } = render(<NamedCorridorsScreen />);
    expect(getByTestId('named-corridors-empty')).toBeTruthy();
    expect(queryByTestId('named-corridor-intent-1')).toBeNull();
  });

  it('lists one name with the section carrying it', () => {
    withCorridors([RESOLVED]);
    const { getByTestId, getByText } = render(<NamedCorridorsScreen />);
    expect(getByTestId('named-corridor-intent-1')).toBeTruthy();
    expect(getByText('The river climb')).toBeTruthy();
    fireEvent.press(getByTestId('named-corridor-intent-1-open'));
    expect(mockPush).toHaveBeenCalledWith('/section/sec-1');
  });

  it('marks a dormant name and gives it nothing to open', () => {
    withCorridors([DORMANT]);
    const { getByTestId, queryByTestId } = render(<NamedCorridorsScreen />);
    expect(getByTestId('named-corridor-intent-2-dormant')).toBeTruthy();
    expect(queryByTestId('named-corridor-intent-2-open')).toBeNull();
  });

  it('keeps two names that landed on the same ground apart', () => {
    withCorridors([RESOLVED, { ...DORMANT, sectionId: 'sec-1', dormant: false }]);
    const { getByTestId } = render(<NamedCorridorsScreen />);
    expect(getByTestId('named-corridor-intent-1')).toBeTruthy();
    expect(getByTestId('named-corridor-intent-2')).toBeTruthy();
    expect(getByTestId('named-corridor-intent-2-secondary')).toBeTruthy();
  });

  it('asks before deleting and does nothing when the user cancels', () => {
    withCorridors([RESOLVED]);
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByTestId } = render(<NamedCorridorsScreen />);
    fireEvent.press(getByTestId('named-corridor-intent-1-delete'));

    const buttons = spy.mock.calls[0][2] as { style?: string; onPress?: () => void }[];
    buttons.find((b) => b.style === 'cancel')?.onPress?.();
    expect(remove).not.toHaveBeenCalled();

    buttons.find((b) => b.style === 'destructive')?.onPress?.();
    expect(remove).toHaveBeenCalledWith('intent-1');
    spy.mockRestore();
  });

  it('confirms a second delete on its own, not off the first', () => {
    withCorridors([RESOLVED, DORMANT]);
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { getByTestId } = render(<NamedCorridorsScreen />);

    fireEvent.press(getByTestId('named-corridor-intent-1-delete'));
    (spy.mock.calls[0][2] as { style?: string; onPress?: () => void }[])
      .find((b) => b.style === 'destructive')
      ?.onPress?.();
    fireEvent.press(getByTestId('named-corridor-intent-2-delete'));
    (spy.mock.calls[1][2] as { style?: string; onPress?: () => void }[])
      .find((b) => b.style === 'destructive')
      ?.onPress?.();

    expect(remove.mock.calls).toEqual([['intent-1'], ['intent-2']]);
    spy.mockRestore();
  });
});
