/**
 * Scenario: the auto-pause threshold list in recording settings.
 *
 * Expected behaviour: the third row, which the recorder applies to every sport
 * outside cycling and running, is labelled through a locale key rather than
 * the literal "Walking".
 */

import React from 'react';
import { render, within } from '@testing-library/react-native';

import RecordingAutoPauseScreen from '@/app/recording-auto-pause';
import RecordingGpsScreen from '@/app/recording-gps-settings';
import RecordingUploadScreen from '@/app/recording-upload';

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
  it('labels the catch-all row as walking and every other sport', async () => {
    const { getByTestId } = await render(<RecordingAutoPauseScreen />);
    const row = getByTestId('settings-threshold-walking');
    expect(within(row).queryByText('recording.settingsAutoPauseWalkingAndOther')).not.toBeNull();
  });

  it('names both accuracy filter controls', async () => {
    const { getByRole, getByTestId } = await render(<RecordingGpsScreen />);
    expect(getByRole('button', { name: 'recording.accuracyFilterDecrease' })).toBe(
      getByTestId('settings-accuracy-filter-minus')
    );
    expect(getByRole('button', { name: 'recording.accuracyFilterIncrease' })).toBe(
      getByTestId('settings-accuracy-filter-plus')
    );
  });

  it('names every switch by the label beside it', async () => {
    const upload = await render(<RecordingUploadScreen />);
    expect(upload.getByRole('switch', { name: 'recording.autoUpload' })).toBeTruthy();
    expect(upload.getAllByRole('switch')).toHaveLength(1);
    await upload.unmount();

    const gps = await render(<RecordingGpsScreen />);
    expect(gps.getByRole('switch', { name: 'recording.keepAwake' })).toBeTruthy();
    expect(gps.getAllByRole('switch')).toHaveLength(1);
    await gps.unmount();

    const pause = await render(<RecordingAutoPauseScreen />);
    expect(pause.getByRole('switch', { name: 'recording.settingsAutoPause' })).toBeTruthy();
    expect(pause.getAllByRole('switch')).toHaveLength(1);
  });
});
