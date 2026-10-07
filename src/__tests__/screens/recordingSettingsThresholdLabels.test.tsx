/**
 * Scenario: the auto-pause threshold list in recording settings.
 *
 * Expected behaviour: the third row, which the recorder applies to every sport
 * outside cycling and running, is labelled through a locale key rather than
 * the literal "Walking".
 */

import React from 'react';
import { render, within } from '@testing-library/react-native';

import RecordingSettingsScreen from '@/app/recording-settings';

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
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

describe('recording settings threshold labels', () => {
  it('labels the catch-all row as walking and every other sport', () => {
    const { getByTestId } = render(<RecordingSettingsScreen />);
    const row = getByTestId('settings-threshold-walking');
    expect(within(row).queryByText('recording.settingsAutoPauseWalkingAndOther')).not.toBeNull();
  });
});
