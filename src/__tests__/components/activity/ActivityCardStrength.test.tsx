/**
 * Scenario: a feed card for a WeightTraining activity mounts.
 *
 * Expected behaviour: the card paints the strength summary the feed hands it
 * and reads nothing from the engine itself; with no summary it draws an
 * ordinary card, whatever the feed has not yet read.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { ActivityCard } from '@/features/activity/components/ActivityCard';
import type { Activity } from '@/types';

const mockGetEngine = jest.fn(() => null);
jest.mock('@/shared/native/engine', () => ({
  ...jest.requireActual('@/shared/native/engine'),
  getEngine: () => mockGetEngine(),
}));

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    getStyleForActivity: () => 'satellite',
    getTerrain3DMode: () => 'smart',
    getActivityCamera: () => undefined,
    setActivityOverride: jest.fn(),
    clearActivityOverride: jest.fn(),
    hasActivityOverride: () => false,
  }),
}));

jest.mock('@/features/strength', () => {
  const { Text } = require('react-native');
  return {
    StrengthActivityCard: ({ strengthData }: { strengthData: { setCount: number } }) => (
      <Text testID="strength-card">{strengthData.setCount}</Text>
    ),
  };
});

jest.mock('@/features/activity/components/ActivityMapPreview', () => ({
  ActivityMapPreview: () => null,
}));

const lift = {
  id: 's1',
  name: 'Push day',
  type: 'WeightTraining',
  start_date_local: '2026-08-12T07:30:00',
  moving_time: 3600,
  stream_types: [],
} as unknown as Activity;

const strengthData = { muscles: [], exerciseCount: 3, setCount: 9, totalWeight: 2400 };

describe('a strength card in the feed', () => {
  beforeEach(() => mockGetEngine.mockClear());

  it('paints the summary it is handed', async () => {
    await render(<ActivityCard activity={lift} strengthData={strengthData} />);
    expect(screen.getByTestId('strength-card').props.children).toBe(9);
  });

  it('reads nothing from the engine', async () => {
    await render(<ActivityCard activity={lift} strengthData={strengthData} />);
    expect(mockGetEngine).not.toHaveBeenCalled();
  });

  it('draws an ordinary card while the feed has no summary for it', async () => {
    await render(<ActivityCard activity={lift} />);
    expect(screen.queryByTestId('strength-card')).toBeNull();
    expect(screen.getByTestId('activity-card-s1')).toBeTruthy();
  });
});
