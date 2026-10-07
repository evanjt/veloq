/**
 * Scenario: selecting an activity changes `routeColor` and `coordinates` in one
 * render. The colour sat in the page memo keys, so the page rebuilt, and the
 * rebuilt page was given the route from before the tap.
 *
 * Expected behaviour: the page is the same page, and the route and its colour
 * arrive through `setRoute`, including when they arrive before the page is ready
 * and after a reload.
 */

import React from 'react';
import { View } from 'react-native';
import { render, act } from '@testing-library/react-native';

import { Map3DWebView } from '@/features/maps/components/Map3DWebView';

const injected: string[] = [];
let onMessage: ((event: { nativeEvent: { data: string } }) => void) | null = null;
let onCrash: (() => void) | null = null;
let html: string | undefined;

jest.mock('react-native-webview', () => ({
  get WebView() {
    return mockWebView;
  },
}));

const mockWebView = React.forwardRef(function MockWebView(
  props: {
    onMessage: (event: { nativeEvent: { data: string } }) => void;
    onRenderProcessGone: () => void;
    source: { html: string };
  },
  ref: React.Ref<{ injectJavaScript: (script: string) => void; reload: () => void }>
) {
  onMessage = props.onMessage;
  onCrash = props.onRenderProcessGone;
  html = props.source.html;
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: (script: string) => injected.push(script),
    reload: () => {},
    stopLoading: () => {},
  }));
  return <View />;
});

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

const RIDE = '#112233';
const RUN = '#445566';
const NONE: [number, number][] = [];
const TRACK_A: [number, number][] = [
  [7.1, 46.1],
  [7.2, 46.2],
];
const TRACK_B: [number, number][] = [
  [8.1, 47.1],
  [8.2, 47.2],
];

function surface(coordinates: [number, number][], routeColor?: string, mapStyle = 'light') {
  return (
    <Map3DWebView
      coordinates={coordinates}
      routeColor={routeColor}
      mapStyle={mapStyle as 'light'}
    />
  );
}

function ready() {
  act(() => onMessage?.({ nativeEvent: { data: JSON.stringify({ type: 'mapReady' }) } }));
}

const setRoutes = () => injected.filter((s) => s.includes('_veloq3d.setRoute('));

beforeEach(() => {
  injected.length = 0;
  html = undefined;
});

describe('selecting an activity in 3D', () => {
  it('keeps the page and injects the route with its colour', () => {
    const view = render(surface(NONE));
    ready();
    const before = html;
    injected.length = 0;

    view.rerender(surface(TRACK_A, RIDE));

    expect(html).toBe(before);
    const scripts = setRoutes();
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain(JSON.stringify(TRACK_A));
    expect(scripts[0]).toContain(RIDE);
    view.unmount();
  });

  it('recolours the line when the sport changes and the route does too', () => {
    const view = render(surface(TRACK_A, RIDE));
    ready();
    injected.length = 0;

    view.rerender(surface(TRACK_B, RUN));

    const scripts = setRoutes();
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain(RUN);
    expect(scripts[0]).not.toContain(RIDE);
    view.unmount();
  });

  it('draws a route that arrived before the page was ready once it is', () => {
    const view = render(surface(NONE));
    view.rerender(surface(TRACK_A, RIDE));
    expect(setRoutes()).toHaveLength(0);

    ready();

    const scripts = setRoutes();
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain(JSON.stringify(TRACK_A));
    view.unmount();
  });

  it('does not re-send a route the page was built with', () => {
    const view = render(surface(TRACK_A, RIDE));

    ready();

    expect(setRoutes()).toHaveLength(0);
    view.unmount();
  });

  it('restores the latest route after the render process is lost', () => {
    const view = render(surface(TRACK_A, RIDE));
    ready();
    view.rerender(surface(TRACK_B, RUN));
    injected.length = 0;

    act(() => onCrash?.());
    ready();

    const scripts = setRoutes();
    expect(scripts).toHaveLength(1);
    expect(scripts[0]).toContain(JSON.stringify(TRACK_B));
    expect(scripts[0]).toContain(RUN);
    view.unmount();
  });

  it('builds a rebuilt page with the current route and style', () => {
    const view = render(surface(NONE, undefined, 'light'));
    ready();
    view.rerender(surface(TRACK_A, RIDE, 'satellite'));

    view.rerender(
      <Map3DWebView
        coordinates={TRACK_A}
        routeColor={RIDE}
        mapStyle="satellite"
        initialPitch={30}
      />
    );

    expect(html).toContain(JSON.stringify(TRACK_A));
    view.unmount();
  });
});
