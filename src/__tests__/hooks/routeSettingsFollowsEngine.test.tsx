/**
 * Scenario: a linked browser changes the detection switch while the app is
 * running. The route settings store hydrates once at launch, so without a
 * reload on the engine's settings channel the phone keeps showing the old
 * value until the next launch.
 *
 * Expected behaviour: a settings announcement makes the store read its stored
 * row again, and no other channel does.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';

import { useRouteSettings } from '@/features/routes/stores/RouteSettingsStore';
import { useRouteSettingsFollowsEngine } from '@/features/routes/hooks/useRouteSettingsFollowsEngine';
import { getSetting } from '@/shared/storage';

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => {}),
}));

const listeners: Record<string, (() => void)[]> = {};
jest.mock('@/shared/native/useEngineReady', () => ({
  useEngineReady: () => ({
    subscribe: (event: string, cb: () => void) => {
      (listeners[event] ||= []).push(cb);
      return () => {
        listeners[event] = (listeners[event] || []).filter((l) => l !== cb);
      };
    },
  }),
}));

function Probe() {
  useRouteSettingsFollowsEngine();
  return null;
}

const mockedGet = getSetting as jest.Mock;

beforeEach(() => {
  for (const key of Object.keys(listeners)) delete listeners[key];
  mockedGet.mockReset();
  mockedGet.mockResolvedValue(null);
  useRouteSettings.setState({ settings: { enabled: true }, isLoaded: true });
});

it('re-reads the stored settings when a browser changed them', async () => {
  await render(<Probe />);
  mockedGet.mockResolvedValue(JSON.stringify({ enabled: false }));

  await act(async () => {
    listeners.settings.forEach((cb) => cb());
  });

  expect(useRouteSettings.getState().settings.enabled).toBe(false);
});

vaultIt('does not re-read on a sections announcement', async () => {
  await render(<Probe />);
  mockedGet.mockClear();

  await act(async () => {
    (listeners.sections ?? []).forEach((cb) => cb());
  });

  expect(mockedGet).not.toHaveBeenCalled();
});

vaultIt('reload falls back to the default when nothing is stored', async () => {
  useRouteSettings.setState({ settings: { enabled: false }, isLoaded: true });
  await useRouteSettings.getState().reload();
  expect(useRouteSettings.getState().settings.enabled).toBe(true);
});
