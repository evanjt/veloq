/**
 * Scenario: a slot's shared page loses its map (the renderer dies) and a new card publishes
 * before the page reports ready again.
 *
 * Expected behaviour: the new owner is told ready only when the reloaded page reports it, once.
 */

import React from 'react';
import { Platform, View } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { MapSurfaceSlot, SlottedMapSurface } from '@/features/maps/components/MapSurfaceSlot';
import { RENDERER_RESTART_STAGGER_MS } from '@/features/maps/lib/rendererRecovery';

interface MockProps {
  onMessage: (event: { nativeEvent: { data: string } }) => void;
  onRenderProcessGone?: () => void;
}

const live: { props: MockProps }[] = [];

jest.mock('react-native-webview', () => ({
  get WebView() {
    return mockWebView;
  },
}));

const mockWebView = React.forwardRef(function MockWebView(
  props: MockProps,
  ref: React.Ref<unknown>
) {
  const entry = React.useRef({ props });
  React.useEffect(() => {
    entry.current.props = props;
  });
  React.useEffect(() => {
    const mine = entry.current;
    live.push(mine);
    return () => {
      live.splice(live.indexOf(mine), 1);
    };
  }, []);
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: () => {},
    reload: () => {},
    stopLoading: () => {},
  }));
  return <View />;
});

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: true, colors: { background: '#000' } }),
}));

const originalOs = Platform.OS;

function Card({ onMapReady }: { onMapReady: () => void }) {
  return (
    <SlottedMapSurface
      mapStyle="light"
      initialCamera={{ center: [7.448, 46.949], zoom: 12 }}
      sources={{}}
      layers={[]}
      onMapReady={onMapReady}
    />
  );
}

const page = (children: React.ReactNode) => (
  <MapSurfaceSlot subject="first">{children}</MapSurfaceSlot>
);

const pageReady = () =>
  act(() => {
    live[0].props.onMessage({ nativeEvent: { data: JSON.stringify({ type: 'mapReady' }) } });
  });

beforeEach(() => {
  jest.useFakeTimers();
  Platform.OS = 'android';
  live.length = 0;
});

afterEach(() => {
  Platform.OS = originalOs;
  jest.useRealTimers();
});

it('tells a card published during a renderer reload ready only when the page reports it', async () => {
  const first = jest.fn();
  const second = jest.fn();
  const view = await render(page(<Card key="a" onMapReady={first} />));
  await pageReady();
  expect(first).toHaveBeenCalledTimes(1);

  await act(() => live[0].props.onRenderProcessGone?.());
  await view.rerender(page(<Card key="b" onMapReady={second} />));
  expect(second).not.toHaveBeenCalled();

  await act(() => jest.advanceTimersByTime(RENDERER_RESTART_STAGGER_MS * 8));
  await pageReady();
  expect(second).toHaveBeenCalledTimes(1);
  await view.unmount();
});

it('still tells a card published onto a ready page at once', async () => {
  const second = jest.fn();
  const view = await render(page(<Card key="a" onMapReady={jest.fn()} />));
  await pageReady();
  await view.rerender(page(<Card key="b" onMapReady={second} />));
  expect(second).toHaveBeenCalledTimes(1);
  await view.unmount();
});
