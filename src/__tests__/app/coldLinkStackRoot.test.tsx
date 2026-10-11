/**
 * Scenario: the app is started cold by a system link (a notification, a widget,
 * a Live Activity), so the router builds its first stack from that link alone,
 * or a held ride is resumed at launch over whatever the launch route was.
 *
 * Expected behaviour: the tab group sits under every stack screen, so back on
 * Android goes to the Feed rather than out of the app, and iOS draws a back
 * control. Signing in from a cold link, or being sent to the login screen from
 * one, does not leave a second tab group in the stack.
 */
import React from 'react';
import { Text } from 'react-native';
import { Stack, router } from 'expo-router';

import { AuthGate, unstable_settings } from '@/app/_layout';
import TabsLayout from '@/app/(tabs)/_layout';
import { useAuthStore } from '@/shared/app/AuthStore';
// After the layout: the testing library mocks reanimated for every later import,
// and that mock lacks the logger the root layout configures at load.
import { act, renderRouter } from 'expo-router/testing-library';
import { store } from 'expo-router/build/global-state/router-store';

// The shared setup stubs the router for render tests; this suite needs the real one.
jest.mock('expo-router', () => ({ ...jest.requireActual('expo-router') }));

const mockResumeHeldRide = jest.fn(async (_athleteId: string): Promise<string | null> => null);
jest.mock('@/features/recording', () =>
  require('../__shared__/recordingBarrelStub').withRecordingOverrides({
    adoptOwnerlessRecordings: jest.fn(async () => undefined),
    adoptOwnerlessRecordingBackup: jest.fn(async () => undefined),
    settleOwnerlessAdoptions: jest.fn(async () => undefined),
    RecordingTitle: () => null,
    resumeHeldRecordingForAthlete: (athleteId: string) => mockResumeHeldRide(athleteId),
    startUploadQueue: jest.fn(async () => undefined),
  })
);
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => null,
  getRouteDbPath: () => null,
  isEngineReady: () => false,
}));
jest.mock('@/features/routes/hooks/useRouteReoptimisation', () => ({
  useRouteReoptimisation: () => undefined,
}));
jest.mock('@/shared/app/appBackground', () => ({ handleAppBackground: jest.fn() }));
jest.mock('@/features/settings/lib/autobackup', () => ({
  onAppForeground: jest.fn(),
  initWebdavConfig: jest.fn(async () => undefined),
}));

function RootStub() {
  return (
    <AuthGate>
      <Stack />
    </AuthGate>
  );
}

function leaf(name: string) {
  return function Leaf() {
    return <Text>{name}</Text>;
  };
}

const APP = {
  _layout: { default: RootStub, unstable_settings },
  '(tabs)/_layout': TabsLayout,
  '(tabs)/index': leaf('feed'),
  '(tabs)/map': leaf('map'),
  'activity/[id]': leaf('activity'),
  'section/[id]': leaf('section'),
  'route/[id]': leaf('route'),
  record: leaf('record'),
  'recording/[type]': leaf('recording'),
  'recording/review': leaf('review'),
  login: leaf('login'),
};

type StackState = { index: number; routes: { name: string }[] };

function rootStack(): StackState {
  const state = store.navigationRef.getRootState() as unknown as {
    routes: { name: string; state?: StackState }[];
  };
  // The router wraps the app's root stack in its own `__root` route.
  const stack = state.routes[0]?.state;
  if (!stack) throw new Error('the root stack has not mounted');
  return stack;
}

function routeNames(): string[] {
  return rootStack().routes.map((route) => route.name);
}

async function settle() {
  await act(async () => {
    await jest.runAllTimersAsync();
  });
}

function signedIn() {
  useAuthStore.setState({
    isLoading: false,
    isAuthenticated: true,
    authMethod: 'apiKey',
    apiKey: 'key',
    athleteId: 'i1',
    isDemoMode: false,
  });
}

function signedOut() {
  useAuthStore.setState({
    isLoading: false,
    isAuthenticated: false,
    authMethod: null,
    apiKey: null,
    athleteId: null,
    isDemoMode: false,
  });
}

beforeEach(() => {
  mockResumeHeldRide.mockReset();
  mockResumeHeldRide.mockResolvedValue(null);
  signedIn();
});

it.each([
  ['/activity/i999', 'activity/[id]'],
  ['/section/s1', 'section/[id]'],
  ['/route/r1', 'route/[id]'],
  ['/record', 'record'],
])('a cold link to %s opens over the tab group', async (initialUrl, screen) => {
  const result = renderRouter(APP, { initialUrl });
  await settle();

  expect(routeNames()).toEqual(['(tabs)', screen]);
  expect(result.getPathname()).toBe(initialUrl);
});

it('a plain launch holds the tab group alone', async () => {
  renderRouter(APP, { initialUrl: '/' });
  await settle();

  expect(routeNames()).toEqual(['(tabs)']);
});

it('back from a cold-linked screen lands on the Feed', async () => {
  const result = renderRouter(APP, { initialUrl: '/activity/i999' });
  await settle();

  expect(router.canGoBack()).toBe(true);
  act(() => router.back());
  await settle();
  expect(routeNames()).toEqual(['(tabs)']);
  expect(result.getPathname()).toBe('/');
});

it('a held ride resumed at a plain launch keeps the tab group under it', async () => {
  mockResumeHeldRide.mockResolvedValue('/recording/review');
  renderRouter(APP, { initialUrl: '/' });
  await settle();

  expect(mockResumeHeldRide).toHaveBeenCalledWith('i1');
  expect(routeNames()).toEqual(['(tabs)', 'recording/review']);
});

it('a held ride resumed over a cold link takes its place over the tab group', async () => {
  mockResumeHeldRide.mockResolvedValue('/recording/cycling');
  const result = renderRouter(APP, { initialUrl: '/record' });
  await settle();

  expect(routeNames()).toEqual(['(tabs)', 'recording/[type]']);
  expect(result.getPathname()).toBe('/recording/cycling');
});

it('the record screen swapping itself for the review keeps the tab group under it', async () => {
  renderRouter(APP, { initialUrl: '/record' });
  await settle();

  act(() => router.replace('/recording/review'));
  await settle();
  expect(routeNames()).toEqual(['(tabs)', 'recording/review']);
});

it('a signed-out cold link sends the athlete to login without a tab group to go back to', async () => {
  signedOut();
  const result = renderRouter(APP, { initialUrl: '/activity/i999' });
  await settle();

  expect(result.getPathname()).toBe('/login');
  expect(routeNames()).toEqual(['login']);
});

it('signing in on a cold login screen lands on one tab group', async () => {
  signedOut();
  const result = renderRouter(APP, { initialUrl: '/login' });
  await settle();

  signedIn();
  await settle();

  expect(result.getPathname()).toBe('/');
  expect(routeNames()).toEqual(['(tabs)']);
});

it('signing in after a signed-out cold link lands on one tab group', async () => {
  signedOut();
  const result = renderRouter(APP, { initialUrl: '/section/s1' });
  await settle();

  signedIn();
  await settle();

  expect(result.getPathname()).toBe('/');
  expect(routeNames()).toEqual(['(tabs)']);
});
