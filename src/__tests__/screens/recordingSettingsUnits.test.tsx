/**
 * Scenario: an athlete on imperial units opens recording settings.
 *
 * Expected behaviour: the accuracy filter and the auto-pause thresholds read
 * in feet and mph, while the stored values stay metric.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import RecordingSettingsScreen from '@/app/recording-settings';
import { useRecordingPreferences } from '@/features/recording/stores/RecordingPreferencesStore';

let mockIsMetric = true;

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: { textSecondary: '#888' } }),
  useMetricSystem: () => mockIsMetric,
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

beforeEach(() => {
  useRecordingPreferences.setState({
    autoPauseEnabled: true,
    accuracyRejectThreshold: 50,
    autoPauseThresholds: { cycling: 2, running: 1, walking: 0.5 },
  });
});

describe('recording settings units', () => {
  it('reads metric by default', () => {
    mockIsMetric = true;
    const { queryByText } = render(<RecordingSettingsScreen />);
    expect(queryByText('50 m')).not.toBeNull();
    expect(queryByText('2.0 km/h')).not.toBeNull();
  });

  it('reads feet and mph when the preference is imperial', () => {
    mockIsMetric = false;
    const { queryByText } = render(<RecordingSettingsScreen />);
    expect(queryByText('164 ft')).not.toBeNull();
    expect(queryByText('1.2 mph')).not.toBeNull();
    expect(queryByText('50 m')).toBeNull();
    expect(queryByText('2.0 km/h')).toBeNull();
  });
});
