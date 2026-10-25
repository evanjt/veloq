/**
 * Scenario: the recording map is rendered with live GPS input that may be
 * empty, single-point or malformed.
 *
 * Expected behaviour: it always mounts, never throws, and its controls appear
 * on the documented testIDs. These assertions describe the contract every map
 * implementation has to keep, so they avoid MapLibre-specific prop shapes.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { RecordingMap } from '@/features/recording/components/RecordingMap';
import { MAP_ATTRIBUTIONS } from '@/features/maps/components/mapStyles';

// The map page is hidden from screen readers, so a query reaching it includes hidden elements.
const MAP_PAGE = { includeHiddenElements: true };

// The binding registers a TurboModule at import time. A hook on this screen's
// import path compares against one of its generated enums, so the stub is the
// module here.
jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({ preferences: { defaultStyle: 'light' } }),
}));

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));

const TRACK: [number, number][] = [
  [46.948, 7.447],
  [46.949, 7.448],
  [46.95, 7.449],
];

const HERE = { latitude: 46.948, longitude: 7.447 };
const FOLLOWED = {
  id: 'lake',
  name: 'Lake loop',
  distanceMeters: 12_400,
  bestTimeSeconds: 2_482,
  points: [{ lat: 46.948, lng: 7.447 }],
};

// A pan reaches React Native as a bridge message from the map surface, so the
// test posts the same message the page would.
async function panTheMap() {
  await fireEvent(screen.getByTestId('maplibre-map', MAP_PAGE), 'message', {
    nativeEvent: {
      data: JSON.stringify({
        type: 'regionDidChange',
        isUserInteraction: true,
        center: [7.447, 46.948],
        zoom: 15,
        bearing: 0,
        pitch: 0,
        bounds: {
          sw: [7.44, 46.94],
          ne: [7.46, 46.96],
        },
      }),
    },
  });
}

describe('RecordingMap', () => {
  it('mounts with a live track and a current position', async () => {
    await render(<RecordingMap coordinates={TRACK} currentLocation={HERE} />);

    expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
  });

  it('offers recentring only once the user has panned away', async () => {
    await render(<RecordingMap coordinates={TRACK} currentLocation={HERE} />);

    expect(screen.queryByTestId('recording-map-recenter')).toBeNull();

    await panTheMap();

    expect(screen.getByTestId('recording-map-recenter')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('recording-map-recenter'));
    expect(screen.queryByTestId('recording-map-recenter')).toBeNull();
  });

  it('shows the route picker control only when a handler is supplied', async () => {
    const onOpenRoutePicker = jest.fn();
    const { rerender } = await render(<RecordingMap coordinates={TRACK} currentLocation={HERE} />);

    expect(screen.queryByTestId('recording-map-route-overlay')).toBeNull();

    await rerender(
      <RecordingMap
        coordinates={TRACK}
        currentLocation={HERE}
        onOpenRoutePicker={onOpenRoutePicker}
      />
    );

    await fireEvent.press(screen.getByTestId('recording-map-route-overlay'));
    expect(onOpenRoutePicker).toHaveBeenCalledTimes(1);
  });

  it('names each control and says when the route overlay is on', async () => {
    const props = { coordinates: TRACK, currentLocation: HERE, onOpenRoutePicker: jest.fn() };
    const { rerender } = await render(<RecordingMap {...props} />);
    await panTheMap();

    expect(screen.getByRole('button', { name: 'maps.toggleStyle' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'maps.goToLocation' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'recording.routeOverlay.title', selected: false })
    ).toBeTruthy();

    await rerender(<RecordingMap {...props} followedRoute={FOLLOWED} />);

    expect(
      screen.getByRole('button', { name: 'recording.routeOverlay.title', selected: true })
    ).toBeTruthy();
  });

  it('names the followed route on a chip and stops following in one press', async () => {
    const onStopFollowing = jest.fn();
    await render(
      <RecordingMap
        coordinates={TRACK}
        currentLocation={HERE}
        followedRoute={FOLLOWED}
        onStopFollowing={onStopFollowing}
      />
    );

    expect(screen.getByTestId('followed-route-title')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('followed-route-dismiss'));
    expect(onStopFollowing).toHaveBeenCalledTimes(1);
  });

  it('shows no chip while nothing is followed', async () => {
    await render(
      <RecordingMap coordinates={TRACK} currentLocation={HERE} nearbyRoutes={[FOLLOWED]} />
    );

    expect(screen.queryByTestId('followed-route')).toBeNull();
  });

  it('hides the controls in review mode', async () => {
    await render(
      <RecordingMap
        coordinates={TRACK}
        currentLocation={HERE}
        fitBounds
        trimStart={1}
        trimEnd={2}
        onOpenRoutePicker={jest.fn()}
      />
    );

    expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
    expect(screen.queryByTestId('recording-map-route-overlay')).toBeNull();
    expect(screen.queryByTestId('recording-map-recenter')).toBeNull();
  });

  describe('degenerate input', () => {
    const cases: [string, React.ComponentProps<typeof RecordingMap>][] = [
      ['an empty coordinate array', { coordinates: [], currentLocation: null }],
      ['a single coordinate', { coordinates: [TRACK[0]], currentLocation: null }],
      [
        'non-finite coordinates',
        {
          coordinates: [
            [NaN, 7.447],
            [46.949, Infinity],
          ],
          currentLocation: null,
        },
      ],
      [
        'a non-finite current location',
        { coordinates: TRACK, currentLocation: { latitude: NaN, longitude: 7.447 } },
      ],
      [
        'a trim range wider than the track',
        { coordinates: TRACK, currentLocation: HERE, fitBounds: true, trimStart: 0, trimEnd: 99 },
      ],
      ['an empty nearby set', { coordinates: TRACK, currentLocation: HERE, nearbyRoutes: [] }],
      [
        'malformed route lines',
        {
          coordinates: TRACK,
          currentLocation: HERE,
          nearbyRoutes: [{ ...FOLLOWED, points: [{ lat: NaN, lng: 7.447 }] }],
          followedRoute: { ...FOLLOWED, points: [{ lat: NaN, lng: 7.447 }] },
        },
      ],
    ];

    it.each(cases)('survives %s', async (_label, props) => {
      await expect((async () => render(<RecordingMap {...props} />))()).resolves.not.toThrow();
      expect(screen.getByTestId('maplibre-map', MAP_PAGE)).toBeTruthy();
    });
  });

  it.each([
    ['the live map', {}],
    ['the review map', { fitBounds: true }],
  ])('credits the basemap on %s', async (_label, props) => {
    await render(<RecordingMap coordinates={TRACK} currentLocation={HERE} {...props} />);

    expect(screen.getByTestId('map-attribution-text').props.children).toBe(MAP_ATTRIBUTIONS.light);
  });

  it("sits the credit above whatever covers the map's foot", async () => {
    await render(
      <RecordingMap coordinates={TRACK} currentLocation={null} fitBounds coveredBottom={72} />
    );

    expect(StyleSheet.flatten(screen.getByTestId('map-attribution').props.style).bottom).toBe(72);
  });
});
