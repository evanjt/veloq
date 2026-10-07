/**
 * Scenario: a component that only writes map preferences sits under the provider
 * while an activity override changes.
 *
 * Expected behaviour: the writer does not render again, and a reader of
 * `getStyleForActivity` sees the new style.
 */

import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';

import {
  MapPreferencesProvider,
  useMapPreferenceActions,
  useMapPreferences,
} from '@/features/maps';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => {}),
  removeSetting: jest.fn(async () => {}),
}));

describe('map preference actions', () => {
  it('does not re-render a setter-only consumer when a preference changes', async () => {
    let writerRenders = 0;
    let actions: ReturnType<typeof useMapPreferenceActions> | null = null;
    let style = '';
    let loaded = false;

    function Writer() {
      writerRenders += 1;
      actions = useMapPreferenceActions();
      return null;
    }
    function Reader() {
      const prefs = useMapPreferences();
      loaded = prefs.isLoaded;
      style = prefs.getStyleForActivity('Ride', 'a1');
      return null;
    }

    render(
      <MapPreferencesProvider>
        <Writer />
        <Reader />
      </MapPreferencesProvider>
    );
    await waitFor(() => expect(loaded).toBe(true));
    const rendersBefore = writerRenders;
    const setterBefore = actions!.setActivityOverride;
    expect(style).toBe('light');

    await act(async () => {
      await actions!.setActivityOverride('a1', { style: 'satellite' });
    });

    await waitFor(() => expect(style).toBe('satellite'));
    expect(writerRenders).toBe(rendersBefore);
    expect(actions!.setActivityOverride).toBe(setterBefore);
  });
});
