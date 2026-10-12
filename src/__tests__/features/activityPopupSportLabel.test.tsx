import React from 'react';
import { render, screen } from '@testing-library/react-native';

import {
  ActivityPopup,
  type SelectedActivity,
} from '@/features/maps/components/regional/ActivityPopup';
import { initialiseI18n } from '@/i18n';
import type { ActivityBoundsItem } from '@/types';

jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('@/shared/app', () => ({
  useMetricSystem: () => true,
  useTheme: () => ({ isDark: false }),
}));

function selectedActivity(type: ActivityBoundsItem['type']): SelectedActivity {
  return {
    activity: {
      id: 'sample-ride',
      bounds: [
        [46.1, 7.1],
        [46.2, 7.2],
      ],
      type,
      name: 'Morning session',
      date: '2026-10-01T09:00:00Z',
      distance: 12000,
      duration: 1800,
    },
    mapData: null,
    isLoading: false,
  };
}

async function showPopup(type: ActivityBoundsItem['type']) {
  await render(
    <ActivityPopup
      selected={selectedActivity(type)}
      bottom={0}
      onZoom={jest.fn()}
      onClose={jest.fn()}
      onViewDetails={jest.fn()}
    />
  );
}

beforeAll(async () => {
  await initialiseI18n();
});

describe('activity popup sport label', () => {
  it('shows the translated sport name', async () => {
    await showPopup('VirtualRide');
    expect(screen.getByText('Virtual Ride')).toBeTruthy();
    expect(screen.queryByText('VirtualRide')).toBeNull();
  });

  it('shows an unknown sport key when it has no translation', async () => {
    await showPopup('FutureSport' as ActivityBoundsItem['type']);
    expect(screen.getByText('FutureSport')).toBeTruthy();
  });
});
