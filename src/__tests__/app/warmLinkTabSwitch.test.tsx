/**
 * Scenario: the app is open and system links arrive one after another, each to
 * a tab, a stack screen over the tabs, or the root, as a widget, a notification
 * or a test driver sends them.
 *
 * Expected behaviour: a link to the root always brings the Feed to the front,
 * whichever tab or stack screen was in front, and the address the tab bar reads
 * agrees with the tab that is drawn.
 */
import React from 'react';
import { Text } from 'react-native';
import { Stack } from 'expo-router';

import { AuthGate, unstable_settings } from '@/app/_layout';
import TabsLayout from '@/app/(tabs)/_layout';
import FeedLayout from '@/app/(tabs)/(feed)/_layout';
import FitnessLayout from '@/app/(tabs)/fitness/_layout';
import InsightsLayout from '@/app/(tabs)/insights/_layout';
import TrainingLayout from '@/app/(tabs)/training/_layout';
import { useAuthStore } from '@/shared/app/AuthStore';
// After the layout: the testing library mocks reanimated for every later import,
// and that mock lacks the logger the root layout configures at load.
import { act, renderRouter, screen } from 'expo-router/testing-library';

// The shared setup stubs the router for render tests; this suite needs the real one.
jest.mock('expo-router', () => ({ ...jest.requireActual('expo-router') }));

type UrlListener = (event: { url: string }) => void;
const mockUrlListeners: UrlListener[] = [];
jest.mock('expo-linking', () => {
  const actual = jest.requireActual('expo-linking');
  return {
    ...actual,
    addEventListener: (type: string, listener: UrlListener) => {
      if (type === 'url') mockUrlListeners.push(listener);
      return {
        remove: () => {
          const at = mockUrlListeners.indexOf(listener);
          if (at >= 0) mockUrlListeners.splice(at, 1);
        },
      };
    },
  };
});

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
  '(tabs)/training/_layout': TrainingLayout,
  '(tabs)/training/index': leaf('training'),
  '(tabs)/insights/_layout': InsightsLayout,
  '(tabs)/insights/index': leaf('insights'),
  '(tabs)/map': leaf('map'),
  'activity/[id]': leaf('activity'),
  settings: leaf('settings'),
  about: leaf('about'),
  login: leaf('login'),
};

type NavState = { index?: number; routes: { name: string; state?: NavState }[] };

let app: Awaited<ReturnType<typeof renderRouter>>;

/** The app rendered at a link, kept so the state helpers read its router. */
async function open(options: { initialUrl: string }) {
  app = await renderRouter(APP, options);
  return app;
}

/** The route names from the root down to the screen in front. */
function focusedChain(): string[] {
  const chain: string[] = [];
  let state = app.getRouterState() as unknown as NavState | undefined;
  while (state) {
    const route = state.routes[state.index ?? state.routes.length - 1];
    if (!route) break;
    chain.push(route.name);
    state = route.state;
  }
  return chain;
}

async function settle() {
  await act(async () => {
    await jest.runAllTimersAsync();
  });
}

/** Opens `path` the way the system hands the app a link: `veloq://insights`, `veloq://`. */
async function openLink(path: string) {
  const url = `veloq://${path.replace(/^\//, '')}`;
  await act(async () => {
    for (const listener of [...mockUrlListeners]) listener({ url });
  });
  await settle();
}

beforeEach(() => {
  mockUrlListeners.length = 0;
  useAuthStore.setState({
    isLoading: false,
    isAuthenticated: true,
    authMethod: 'apiKey',
    apiKey: 'key',
    athleteId: 'i1',
    isDemoMode: false,
  });
});

async function expectFeedInFront(result: Awaited<ReturnType<typeof renderRouter>>) {
  expect(result.getPathname()).toBe('/');
  expect(focusedChain()).toEqual(['__root', '(tabs)', '(feed)', 'index']);
  expect(screen.getByText('feed')).toBeVisible();
}

it.each([['/fitness'], ['/training'], ['/map'], ['/insights']])(
  'a root link after a link to %s brings the Feed to the front',
  async (tab) => {
    const result = await open({ initialUrl: '/' });
    await settle();
    expect(mockUrlListeners.length).toBeGreaterThan(0);

    await openLink(tab);
    expect(result.getPathname()).toBe(tab);

    await openLink('/');
    await expectFeedInFront(result);
  }
);

it.each([['/settings'], ['/about'], ['/activity/a1']])(
  'a root link over the stack screen %s pops it and brings the Feed to the front',
  async (stackScreen) => {
    const result = await open({ initialUrl: '/' });
    await settle();

    await openLink('/insights');
    await openLink(stackScreen);
    expect(result.getPathname()).toBe(stackScreen);

    await openLink('/');
    await expectFeedInFront(result);
  }
);

it('the Feed is in front after every root link in a run of rapid links', async () => {
  const result = await open({ initialUrl: '/' });
  await settle();

  for (let cycle = 0; cycle < 2; cycle++) {
    for (const tab of ['/fitness', '/training', '/map']) await openLink(tab);
    await openLink('/');
    await expectFeedInFront(result);
  }
  for (let cycle = 0; cycle < 2; cycle++) {
    for (const path of ['/settings', '/about', '/insights']) await openLink(path);
    await openLink('/');
    await expectFeedInFront(result);
  }
  for (let cycle = 0; cycle < 2; cycle++) {
    for (const id of ['a0', 'a1', 'a2']) await openLink(`/activity/${id}`);
    await openLink('/');
    await expectFeedInFront(result);
  }
});
