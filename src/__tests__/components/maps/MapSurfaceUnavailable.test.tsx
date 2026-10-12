/**
 * Scenario: the MapLibre renderer comes from a CDN. With the radio off and a
 * cold WebView cache the page never draws, and every 2D surface built on it is
 * a blank rectangle with no error and no retry.
 *
 * Expected behaviour: MapSurface hears the page's `mapFailed`, and the WebView's
 * own load and HTTP errors, and shows a basemap-unavailable state instead of
 * nothing. A surface that loads normally never shows it, and a load that
 * arrives late clears it.
 */

import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';

import {
  MapSurface,
  MAP_SURFACE_TEST_ID,
  MAP_SURFACE_UNAVAILABLE_TEST_ID,
} from '@/features/maps/components/MapSurface';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: true }),
}));

function renderSurface(props: Partial<React.ComponentProps<typeof MapSurface>> = {}) {
  return render(
    <MapSurface
      mapStyle="light"
      initialCamera={{ center: [7.448, 46.949], zoom: 12 }}
      sources={{}}
      layers={[]}
      {...props}
    />
  );
}

const post = (message: object) =>
  fireEvent(screen.getByTestId(MAP_SURFACE_TEST_ID), 'message', {
    nativeEvent: { data: JSON.stringify(message) },
  });

describe('MapSurface basemap availability', () => {
  it('shows nothing extra on a surface that has not failed', async () => {
    await renderSurface();

    expect(screen.queryByTestId(MAP_SURFACE_UNAVAILABLE_TEST_ID)).toBeNull();
  });

  it('shows the unavailable state when the page reports it cannot load', async () => {
    const onMapFailed = jest.fn();
    await renderSurface({ onMapFailed });

    await post({ type: 'mapFailed', reason: 'ready timeout' });

    expect(screen.getByTestId(MAP_SURFACE_UNAVAILABLE_TEST_ID)).toBeTruthy();
    expect(onMapFailed).toHaveBeenCalledWith('ready timeout');
  });

  it('treats a WebView load error as a failure', async () => {
    const onMapFailed = jest.fn();
    await renderSurface({ onMapFailed });

    await fireEvent(screen.getByTestId(MAP_SURFACE_TEST_ID), 'error', {
      nativeEvent: { description: 'net::ERR_NAME_NOT_RESOLVED' },
    });

    expect(screen.getByTestId(MAP_SURFACE_UNAVAILABLE_TEST_ID)).toBeTruthy();
    expect(onMapFailed).toHaveBeenCalled();
  });

  it('treats a WebView HTTP error as a failure', async () => {
    const onMapFailed = jest.fn();
    await renderSurface({ onMapFailed });

    await fireEvent(screen.getByTestId(MAP_SURFACE_TEST_ID), 'httpError', {
      nativeEvent: { statusCode: 503, url: 'https://veloq.fit/' },
    });

    expect(screen.getByTestId(MAP_SURFACE_UNAVAILABLE_TEST_ID)).toBeTruthy();
    expect(onMapFailed).toHaveBeenCalled();
  });

  it('clears the unavailable state when the page loads after all', async () => {
    const onMapReady = jest.fn();
    await renderSurface({ onMapReady });

    await post({ type: 'mapFailed', reason: 'ready timeout' });
    expect(screen.getByTestId(MAP_SURFACE_UNAVAILABLE_TEST_ID)).toBeTruthy();

    await post({ type: 'mapReady' });

    expect(screen.queryByTestId(MAP_SURFACE_UNAVAILABLE_TEST_ID)).toBeNull();
    expect(onMapReady).toHaveBeenCalled();
  });

  it('reports the failure once, however many errors arrive', async () => {
    const onMapFailed = jest.fn();
    await renderSurface({ onMapFailed });

    await post({ type: 'mapFailed', reason: 'ready timeout' });
    await post({ type: 'mapFailed', reason: 'page error' });
    await fireEvent(screen.getByTestId(MAP_SURFACE_TEST_ID), 'error', { nativeEvent: {} });

    expect(onMapFailed).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId(MAP_SURFACE_UNAVAILABLE_TEST_ID)).toBeTruthy();
  });

  it('can fail again after a recovery', async () => {
    const onMapFailed = jest.fn();
    await renderSurface({ onMapFailed });

    await post({ type: 'mapFailed', reason: 'ready timeout' });
    await post({ type: 'mapReady' });
    await post({ type: 'mapFailed', reason: 'style gone' });

    expect(onMapFailed).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId(MAP_SURFACE_UNAVAILABLE_TEST_ID)).toBeTruthy();
  });
});
