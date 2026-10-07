/**
 * Scenario: a ride climbing 612 m is reviewed by an imperial athlete. The
 * elevation cell must show feet converted from metres, not the metre figure
 * under a feet label.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { ActivityStatsCard } from '@/features/recording/components/ActivityStatsCard';
import { useMetricSystem } from '@/shared/app';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  useMetricSystem: jest.fn(() => true),
}));

function renderCard() {
  return render(
    <ActivityStatsCard
      summary={{ duration: 3600, distance: 20000, elevationGain: 612 }}
      textPrimary="#000"
      textSecondary="#000"
    />
  );
}

describe('ActivityStatsCard elevation', () => {
  it('converts metres to feet for an imperial athlete', () => {
    (useMetricSystem as jest.Mock).mockReturnValue(false);
    const { getByText } = renderCard();
    expect(getByText('2008 ft ↑')).toBeTruthy();
  });

  it('shows metres for a metric athlete', () => {
    (useMetricSystem as jest.Mock).mockReturnValue(true);
    const { getByText } = renderCard();
    expect(getByText('612 m ↑')).toBeTruthy();
  });
});
