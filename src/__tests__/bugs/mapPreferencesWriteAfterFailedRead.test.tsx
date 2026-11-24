/**
 * Scenario: the stored map preferences and activity overrides cannot be read
 * at launch, and the athlete changes a map setting before a read succeeds.
 *
 * Expected behaviour: nothing is written over the stored values until a read
 * has succeeded, and the next write retries the read.
 */

import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';

import {
  MapPreferencesProvider,
  useMapPreferenceActions,
  useMapPreferences,
} from '@/features/settings';
import { getSetting, setSetting } from '@/shared/storage';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(),
  setSetting: jest.fn(async () => {}),
  removeSetting: jest.fn(async () => {}),
}));

const mockGet = getSetting as jest.Mock;
const mockSet = setSetting as jest.Mock;

async function mountProvider() {
  let actions!: ReturnType<typeof useMapPreferenceActions>;
  let loaded = false;
  function Probe() {
    actions = useMapPreferenceActions();
    loaded = useMapPreferences().isLoaded;
    return null;
  }
  await render(
    <MapPreferencesProvider>
      <Probe />
    </MapPreferencesProvider>
  );
  await waitFor(() => expect(loaded).toBe(true));
  return () => actions;
}

beforeEach(() => {
  mockGet.mockReset();
  mockSet.mockClear();
});

describe('a write after a failed read', () => {
  it('writes neither overrides nor preferences until a read succeeds', async () => {
    mockGet.mockRejectedValue(new Error('storage unreadable'));
    const actions = await mountProvider();

    await act(async () => {
      await actions().setActivityOverride('a1', { style: 'dark' });
      await actions().setDefaultStyle('satellite');
    });

    expect(mockSet).not.toHaveBeenCalled();
  });

  it('retries the read on a write, then saves on top of what is stored', async () => {
    mockGet.mockRejectedValue(new Error('storage unreadable'));
    const actions = await mountProvider();
    await act(async () => {
      await actions().setActivityOverride('a1', { style: 'dark' });
    });
    expect(mockSet).not.toHaveBeenCalled();

    mockGet.mockImplementation(async (key: string) =>
      key === 'veloq-map-activity-overrides' ? JSON.stringify({ a2: { style: 'light' } }) : null
    );
    await act(async () => {
      await actions().setActivityOverride('a3', { style: 'satellite' });
    });
    expect(mockSet).not.toHaveBeenCalled();

    await act(async () => {
      await actions().setActivityOverride('a4', { style: 'dark' });
    });

    await waitFor(() => expect(mockSet).toHaveBeenCalled());
    const [, written] = mockSet.mock.calls.at(-1)!;
    expect(Object.keys(JSON.parse(written)).sort()).toEqual(['a2', 'a4']);
  });
});
