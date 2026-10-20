/**
 * Scenario: a link opens the Fitness tab on a named page, the athlete moves to
 * another page by hand, and the same link arrives again, as a widget, a
 * notification or a test driver sends it.
 *
 * Expected behaviour: every link that names a page brings that page to the
 * front, whether the screen was already mounted or not, and whether or not the
 * link is the one that first placed it.
 */
import React from 'react';
import { Pressable, Text } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';

import { AuthGate, unstable_settings } from '@/app/_layout';
import TabsLayout from '@/app/(tabs)/_layout';
import FeedLayout from '@/app/(tabs)/(feed)/_layout';
import { fitnessEntryFromParams, type FitnessPlace } from '@/shared/app/fitnessEntry';
import { useFitnessPlace } from '@/shared/app/useFitnessPlace';
import FitnessLayout from '@/app/(tabs)/fitness/_layout';
import InsightsLayout from '@/app/(tabs)/insights/_layout';
import SettingsLayout from '@/app/(tabs)/settings/_layout';
import { useAuthStore } from '@/shared/app/AuthStore';
// After the layout: the testing library mocks reanimated for every later import,
// and that mock lacks the logger the root layout configures at load.
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';

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

/** The fitness tab reduced to its page: which one is in front, and a tab that moves it. */
function FitnessPages() {
  const params = useLocalSearchParams<{ tab?: string; chart?: string }>();
  const [place, setPlace] = useFitnessPlace(fitnessEntryFromParams(params));
  const pick = (next: FitnessPlace) => () => setPlace(next);
  return (
    <>
      <Text testID="page">{place}</Text>
      <Pressable testID="tab-calendar" onPress={pick('calendar')} />
      <Pressable testID="tab-trends" onPress={pick('trends')} />
    </>
  );
}

const APP = {
  _layout: { default: RootStub, unstable_settings },
  '(tabs)/_layout': TabsLayout,
  '(tabs)/(feed)/_layout': FeedLayout,
  '(tabs)/(feed)/index': leaf('feed'),
  '(tabs)/fitness/_layout': FitnessLayout,
  '(tabs)/fitness/index': FitnessPages,
  '(tabs)/insights/_layout': InsightsLayout,
  '(tabs)/insights/index': leaf('insights'),
  '(tabs)/map': leaf('map'),
  '(tabs)/settings/_layout': SettingsLayout,
  '(tabs)/settings/index': leaf('settings'),
  login: leaf('login'),
};

async function settle() {
  await act(async () => {
    await jest.runAllTimersAsync();
  });
}

async function openLink(path: string) {
  const url = `veloq://${path.replace(/^\//, '')}`;
  await act(async () => {
    for (const listener of [...mockUrlListeners]) listener({ url });
  });
  await settle();
}

async function tap(testID: string) {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
  await settle();
}

const page = () => screen.getByTestId('page').props.children;

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

it('the same page link from another tab, after a page change by hand, moves the page back', async () => {
  await renderRouter(APP, { initialUrl: '/' });
  await settle();

  await openLink('/fitness?tab=fitness');
  expect(page()).toBe('fitness');

  await tap('tab-calendar');
  expect(page()).toBe('calendar');

  await openLink('/fitness?tab=fitness');
  expect(page()).toBe('fitness');
});

it('the same page link a third time still moves the page', async () => {
  await renderRouter(APP, { initialUrl: '/' });
  await settle();

  for (const away of ['tab-calendar', 'tab-trends']) {
    await openLink('/fitness?tab=fitness');
    expect(page()).toBe('fitness');
    await tap(away);
  }
  await openLink('/fitness?tab=fitness');
  expect(page()).toBe('fitness');
});

it('a cold link that names a page opens on it, and the same link later moves back to it', async () => {
  await renderRouter(APP, { initialUrl: '/fitness?tab=calendar' });
  await settle();
  expect(page()).toBe('calendar');

  await tap('tab-trends');
  await openLink('/fitness?tab=calendar');
  expect(page()).toBe('calendar');
});

it('a link naming another page moves the mounted screen to it', async () => {
  await renderRouter(APP, { initialUrl: '/' });
  await settle();

  await openLink('/fitness?tab=fitness');
  await openLink('/fitness?tab=performance');
  expect(page()).toBe('performance');
});

it('a link from another tab after a page change brings the same page back', async () => {
  await renderRouter(APP, { initialUrl: '/' });
  await settle();

  await openLink('/fitness?tab=fitness');
  await tap('tab-calendar');
  await openLink('/insights');
  await openLink('/fitness?tab=fitness');
  expect(page()).toBe('fitness');
});

it('a plain link to the tab keeps the page the athlete left it on', async () => {
  await renderRouter(APP, { initialUrl: '/' });
  await settle();

  await openLink('/fitness?tab=fitness');
  await tap('tab-calendar');
  await openLink('/fitness');
  expect(page()).toBe('calendar');
});
