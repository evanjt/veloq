/**
 * Scenario: reduce motion is turned on while a 2D or 3D map is on screen, or
 * while its page is still loading.
 *
 * Expected behaviour: the page is told the new setting by injection, without
 * being rebuilt, and a page that loaded through the change is told once it is
 * ready, so every later camera move reads the setting the athlete has now.
 */

import React from 'react';
import { View } from 'react-native';
import { render, act } from '@testing-library/react-native';

import { MapSurface } from '@/features/maps/components/MapSurface';
import { Map3DWebView } from '@/features/maps/components/Map3DWebView';

const injected: string[] = [];
const pages: string[] = [];
let onMessage: ((event: { nativeEvent: { data: string } }) => void) | null = null;

jest.mock('react-native-webview', () => ({
  get WebView() {
    return mockWebView;
  },
}));

const mockWebView = React.forwardRef(function MockWebView(
  props: {
    onMessage: (event: { nativeEvent: { data: string } }) => void;
    source?: { html?: string };
  },
  ref: React.Ref<unknown>
) {
  onMessage = props.onMessage;
  const html = props.source?.html;
  if (html && pages[pages.length - 1] !== html) pages.push(html);
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: (script: string) => injected.push(script),
    reload: () => {},
    stopLoading: () => {},
  }));
  return <View />;
});

const mockSetting = {
  value: false,
  listeners: new Set<() => void>(),
};

jest.mock('@/shared/ui/reduceMotion', () => {
  const actual = jest.requireActual('@/shared/ui/reduceMotion');
  const { useSyncExternalStore } = jest.requireActual('react');
  const subscribe = (listener: () => void) => {
    mockSetting.listeners.add(listener);
    return () => mockSetting.listeners.delete(listener);
  };
  return {
    ...actual,
    useReduceMotion: () => useSyncExternalStore(subscribe, () => mockSetting.value),
  };
});

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: true }) }));

async function changeSetting(enabled: boolean): Promise<void> {
  await act(() => {
    mockSetting.value = enabled;
    mockSetting.listeners.forEach((listener) => listener());
  });
}

async function ready(): Promise<void> {
  await act(() => onMessage?.({ nativeEvent: { data: JSON.stringify({ type: 'mapReady' }) } }));
}

const told = (enabled: boolean) =>
  injected.filter((script) => script.includes(`window._veloqReduceMotion = ${enabled};`));

const SURFACES: [string, () => React.ReactElement][] = [
  [
    '2D surface',
    () => (
      <MapSurface
        mapStyle="light"
        initialCamera={{ center: [7.448, 46.949], zoom: 12 }}
        sources={{}}
        layers={[]}
      />
    ),
  ],
  [
    '3D terrain',
    () => <Map3DWebView coordinates={[[7.4, 46.9]]} mapStyle="light" routesGeoJSON={undefined} />,
  ],
];

beforeEach(() => {
  injected.length = 0;
  pages.length = 0;
  onMessage = null;
  mockSetting.value = false;
  jest.useFakeTimers();
});

afterEach(() => jest.useRealTimers());

describe.each(SURFACES)('%s follows the live reduce-motion setting', (_name, element) => {
  it('builds the page with the setting it has at mount', async () => {
    mockSetting.value = true;
    const view = await render(element());
    expect(pages).toHaveLength(1);
    // The 2D page sets it as a statement, the 3D page from its build call.
    expect(pages[0]).toMatch(/window\._veloqReduceMotion = true;|\n\s*reduceMotion: true,\n/);
    await ready();
    expect(told(true)).toEqual([]);
    await view.unmount();
  });

  it('tells a ready page about a change, and does not rebuild it', async () => {
    const view = await render(element());
    await ready();

    await changeSetting(true);
    expect(told(true)).toHaveLength(1);

    await changeSetting(false);
    expect(told(false)).toHaveLength(1);
    expect(pages).toHaveLength(1);
    await view.unmount();
  });

  it('tells a page that was loading through the change once it is ready', async () => {
    const view = await render(element());
    await changeSetting(true);
    expect(told(true)).toEqual([]);

    await ready();
    expect(told(true)).toHaveLength(1);
    expect(pages).toHaveLength(1);
    await view.unmount();
  });
});
