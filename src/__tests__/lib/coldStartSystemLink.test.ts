/**
 * Scenario: the process is dead and a home-screen widget opens the app with a
 * deep link. On Android the router asks the system for the launch URL and gives
 * up after a fixed wait, so a cold start whose activity resumes late hands the
 * router its root URL, and the app opens on the Feed.
 * Expected behaviour: the launch link the router finally starts from is the
 * widget's link, armed as a quick start, however late the system answers; a
 * launch with no link still starts at the root.
 */

import * as ExpoLinking from 'expo-linking';
import { getLinkingConfig } from 'expo-router/build/getLinkingConfig';
import { Linking, Platform } from 'react-native';

import * as nativeIntent from '@/app/+native-intent';

jest.mock('expo-constants', () => {
  const actual = jest.requireActual('expo-constants');
  return {
    ...actual,
    __esModule: true,
    default: {
      ...actual.default,
      executionEnvironment: actual.ExecutionEnvironment.Bare,
      expoConfig: { scheme: 'veloq' },
    },
  };
});

const WIDGET_LINK = 'veloq://recording/Ride?from=quickstart';

/** The app directory as the router sees it: only the native intent hook matters here. */
function appContext() {
  const context = (key: string) => {
    if (key !== './+native-intent.ts') throw new Error(`unexpected route module ${key}`);
    return nativeIntent;
  };
  context.keys = () => ['./+native-intent.ts'];
  return context as unknown as Parameters<typeof getLinkingConfig>[1];
}

/** The URL the router starts from, read the way it reads it at launch. */
function launchUrl(): Promise<string | null | undefined> {
  const linking = getLinkingConfig(null as never, appContext(), () => ({ segments: [] }) as never, {
    metaOnly: true,
    skipGenerated: true,
    sitemap: false,
    notFound: false,
  });
  return Promise.resolve(linking.getInitialURL?.());
}

/** The system answers every query for the launch intent once the activity resumes. */
function activityResumesAfter(ms: number, url: string | null) {
  let answer: Promise<string | null> | undefined;
  return jest.spyOn(Linking, 'getInitialURL').mockImplementation(() => {
    answer ??= new Promise((resolve) => setTimeout(() => resolve(url), ms));
    return answer as Promise<string>;
  });
}

describe('the launch URL on an Android cold start', () => {
  const originalOS = Platform.OS;
  const globals = globalThis as { window?: unknown };

  beforeEach(() => {
    jest.useFakeTimers();
    Platform.OS = 'android';
    // The router reads no launch URL at all where there is no window.
    globals.window = globalThis;
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    Platform.OS = originalOS;
    delete globals.window;
  });

  it('opens the widget link when the system answers within the router wait', async () => {
    activityResumesAfter(20, WIDGET_LINK);
    const url = launchUrl();
    await jest.advanceTimersByTimeAsync(20);
    await expect(url).resolves.toBe(WIDGET_LINK);
  });

  it('opens the widget link when the system answers after the router stopped waiting', async () => {
    activityResumesAfter(900, WIDGET_LINK);
    const url = launchUrl();
    await jest.advanceTimersByTimeAsync(900);
    await expect(url).resolves.toBe(WIDGET_LINK);
  });

  it('arms a late recording link that carried no quick-start mark', async () => {
    activityResumesAfter(900, 'veloq://recording/Run');
    const url = launchUrl();
    await jest.advanceTimersByTimeAsync(900);
    await expect(url).resolves.toBe('veloq://recording/Run?from=quickstart');
  });

  it('starts at the root when the launch carried no link', async () => {
    activityResumesAfter(20, null);
    const url = launchUrl();
    await jest.advanceTimersByTimeAsync(20);
    await expect(url).resolves.toBe(ExpoLinking.createURL('/'));
  });

  it('starts at the root, not stuck, when the system never answers', async () => {
    jest
      .spyOn(Linking, 'getInitialURL')
      .mockImplementation(() => new Promise<string>(() => undefined));
    const url = launchUrl();
    await jest.advanceTimersByTimeAsync(10_000);
    await expect(url).resolves.toBe(ExpoLinking.createURL('/'));
  });
});
