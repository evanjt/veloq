/**
 * Scenario: demo activities on Swiss routes open on satellite imagery, and the
 * choice is made from the activity's route rather than from a place field on
 * the activity.
 *
 * Expected behaviour: in demo mode an activity on a Swiss route returns
 * satellite, one elsewhere returns the type's default, and outside demo mode
 * every activity returns the default.
 */

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';

import { MapPreferencesProvider, useMapPreferences } from '@/features/maps';
import { useAuthStore } from '@/shared/app/AuthStore';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => {}),
  removeSetting: jest.fn(async () => {}),
}));

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <MapPreferencesProvider>{children}</MapPreferencesProvider>
);

async function styleFor(id: string, type: 'Ride' | 'Run' = 'Ride') {
  const { result } = renderHook(() => useMapPreferences(), { wrapper });
  await waitFor(() => expect(result.current.isLoaded).toBe(true));
  return result.current.getStyleForActivity(type, id);
}

afterEach(() => {
  useAuthStore.setState({ isDemoMode: false });
});

describe('demo map style default', () => {
  it('is satellite for a demo activity on a Swiss route', async () => {
    useAuthStore.setState({ isDemoMode: true });
    expect(await styleFor('demo-test-0')).toBe('satellite');
  });

  it('is the type default for a demo activity on a route elsewhere', async () => {
    useAuthStore.setState({ isDemoMode: true });
    expect(await styleFor('demo-test-1', 'Run')).toBe('light');
  });

  it('is the type default for an id that is not a demo activity', async () => {
    useAuthStore.setState({ isDemoMode: true });
    expect(await styleFor('i12345')).toBe('light');
  });

  it('is the type default outside demo mode', async () => {
    useAuthStore.setState({ isDemoMode: false });
    expect(await styleFor('demo-test-0')).toBe('light');
  });
});
