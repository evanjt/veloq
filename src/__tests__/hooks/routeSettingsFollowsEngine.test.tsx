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

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides(
    require('../__shared__/veloqrsStub').namespacesOver(() =>
      require('@/shared/native/engine').getEngine()
    )
  )
);
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => {}),
}));

let mockEngineSwitch: string | undefined;
const mockTriggerRefresh = jest.fn();
const listeners: Record<string, (() => void)[]> = {};
jest.mock('@/shared/native/engine', () => ({
  isEngineReady: () => true,
  getEngine: () => ({
    getSetting: () => mockEngineSwitch,
    triggerRefresh: mockTriggerRefresh,
    subscribe: (event: string, cb: () => void) => {
      (listeners[event] ||= []).push(cb);
      return () => {
        listeners[event] = (listeners[event] || []).filter((l) => l !== cb);
      };
    },
  }),
}));

jest.mock('@/shared/native/useEngineReady', () => ({
  useEngineReady: () => true,
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
  mockEngineSwitch = undefined;
  mockTriggerRefresh.mockClear();
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

it('follows the engine switch when a browser turned detection off', async () => {
  await render(<Probe />);
  mockedGet.mockResolvedValue(JSON.stringify({ enabled: true }));
  mockEngineSwitch = '0';

  await act(async () => {
    listeners.settings.forEach((cb) => cb());
  });

  expect(useRouteSettings.getState().settings.enabled).toBe(false);
});

it('follows the engine switch when a browser turned detection on', async () => {
  useRouteSettings.setState({ settings: { enabled: false }, isLoaded: true });
  await render(<Probe />);
  mockedGet.mockResolvedValue(JSON.stringify({ enabled: false }));
  mockEngineSwitch = '1';

  await act(async () => {
    listeners.settings.forEach((cb) => cb());
  });

  expect(useRouteSettings.getState().settings.enabled).toBe(true);
});

it('refreshes sections and groups when a browser flipped the switch', async () => {
  await render(<Probe />);
  mockEngineSwitch = '0';

  await act(async () => {
    listeners.settings.forEach((cb) => cb());
  });

  const channels = mockTriggerRefresh.mock.calls.map((c) => c[0]);
  expect(channels).toEqual(expect.arrayContaining(['sections', 'groups']));
});

it('does not refresh when a settings announcement leaves the switch as it was', async () => {
  await render(<Probe />);
  mockEngineSwitch = '1';

  await act(async () => {
    listeners.settings.forEach((cb) => cb());
  });

  expect(mockTriggerRefresh).not.toHaveBeenCalled();
});
