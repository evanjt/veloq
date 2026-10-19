/**
 * Scenario: on Insights, an insight's sheet is opened and one of its links followed, to a stack
 * screen over the tabs (a section, a route, an activity) or to another tab's own screen (Fitness
 * on the window an insight compared). Then back is pressed, as Android's back button does.
 *
 * Expected behaviour: back from any screen an insight opened returns to Insights. The tab bar
 * keeps its own rule: back from a tab chosen there goes to the Feed.
 */
import React from 'react';
import { Text } from 'react-native';
import { Stack, router } from 'expo-router';

import { AuthGate, unstable_settings } from '@/app/_layout';
import TabsLayout from '@/app/(tabs)/_layout';
import FeedLayout from '@/app/(tabs)/(feed)/_layout';
import FitnessLayout from '@/app/(tabs)/fitness/_layout';
import InsightsLayout from '@/app/(tabs)/insights/_layout';
import SettingsLayout from '@/app/(tabs)/settings/_layout';
import { useAuthStore } from '@/shared/app/AuthStore';
import { goBack, navigateTab, navigateTo } from '@/shared/app/navigation';
// After the layout: the testing library mocks reanimated for every later import,
// and that mock lacks the logger the root layout configures at load.
import { act, renderRouter } from 'expo-router/testing-library';

// The shared setup stubs the router for render tests; this suite needs the real one.
jest.mock('expo-router', () => ({ ...jest.requireActual('expo-router') }));

jest.mock('@/features/recording', () =>
  require('../__shared__/recordingBarrelStub').withRecordingOverrides({
    adoptOwnerlessRecordings: jest.fn(async () => undefined),
    adoptOwnerlessRecordingBackup: jest.fn(async () => undefined),
    settleOwnerlessAdoptions: jest.fn(async () => undefined),
    RecordingTitle: () => null,
    resumeHeldRecordingForAthlete: jest.fn(async () => null),
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
  '(tabs)/(feed)/_layout': FeedLayout,
  '(tabs)/(feed)/index': leaf('feed'),
  '(tabs)/fitness/_layout': FitnessLayout,
  '(tabs)/fitness/index': leaf('fitness'),
  '(tabs)/insights/_layout': InsightsLayout,
  '(tabs)/insights/index': leaf('insights'),
  '(tabs)/map': leaf('map'),
  '(tabs)/settings/_layout': SettingsLayout,
  '(tabs)/settings/index': leaf('settings'),
  'activity/[id]': leaf('activity'),
  'section/[id]/index': leaf('section'),
  'route/[id]/index': leaf('route'),
  'sheets/insight': leaf('insight sheet'),
  login: leaf('login'),
};

let app: Awaited<ReturnType<typeof renderRouter>>;

async function settle() {
  await act(async () => {
    await jest.runAllTimersAsync();
  });
}

async function openApp() {
  app = await renderRouter(APP, { initialUrl: '/' });
  await settle();
}

async function chooseTab(path: string) {
  await act(async () => navigateTab(path));
  await settle();
}

/** Opens the sheet and follows a link the way the sheet does: it closes, then navigates. */
async function followFromSheet(target: string) {
  await act(async () => navigateTo('/sheets/insight'));
  await settle();
  await act(async () => {
    goBack();
    navigateTo(target);
  });
  await settle();
}

/** Android's back button: the container's go-back, bubbling from the screen in front. */
async function pressBack() {
  await act(async () => router.back());
  await settle();
}

beforeEach(() => {
  useAuthStore.setState({
    isLoading: false,
    isAuthenticated: true,
    authMethod: 'apiKey',
    apiKey: 'key',
    athleteId: 'i1',
    isDemoMode: false,
  });
});

it.each([
  ['/section/s1', '/section/s1'],
  ['/route/r1', '/route/r1'],
  ['/activity/a1', '/activity/a1'],
  ['/fitness?range=3m', '/fitness'],
  ['/fitness?date=2026-01-05', '/fitness'],
])('back from %s opened by an insight returns to Insights', async (target, opened) => {
  await openApp();
  await chooseTab('/insights');

  await followFromSheet(target);
  expect(app.getPathname()).toBe(opened);

  await pressBack();
  expect(app.getPathname()).toBe('/insights');
});

it('back from a second insight link into Fitness still returns to Insights', async () => {
  await openApp();
  await chooseTab('/insights');

  await followFromSheet('/fitness?range=3m');
  await pressBack();
  await followFromSheet('/fitness?range=1y');
  expect(app.getPathname()).toBe('/fitness');

  await pressBack();
  expect(app.getPathname()).toBe('/insights');
});

it('back from a tab chosen on the tab bar goes to the Feed', async () => {
  await openApp();
  await chooseTab('/insights');
  await chooseTab('/fitness');

  await pressBack();
  expect(app.getPathname()).toBe('/');
});

it('back from a tab chosen on the tab bar after an insight link goes to the Feed', async () => {
  await openApp();
  await chooseTab('/insights');
  await followFromSheet('/fitness?range=3m');
  await chooseTab('/map');
  await chooseTab('/fitness');

  await pressBack();
  expect(app.getPathname()).toBe('/');
});
