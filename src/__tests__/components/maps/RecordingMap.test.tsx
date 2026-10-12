/**
 * Scenario: the recording map is rendered with live GPS input that may be
 * empty, single-point or malformed.
 *
 * Expected behaviour: it always mounts, never throws, and its controls appear
 * on the documented testIDs. These assertions describe the contract every map
 * implementation has to keep, so they avoid MapLibre-specific prop shapes.
 */

import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { RecordingMap } from '@/features/recording/components/RecordingMap';

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
}));

const TRACK: [number, number][] = [
  [46.948, 7.447],
  [46.949, 7.448],
  [46.95, 7.449],
];

const HERE = { latitude: 46.948, longitude: 7.447 };

// A pan reaches React Native as a bridge message from the map surface, so the
// test posts the same message the page would.
async function panTheMap() {
  await fireEvent(screen.getByTestId('maplibre-map'), 'message', {
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

    expect(screen.getByTestId('maplibre-map')).toBeTruthy();
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

    await rerender(<RecordingMap {...props} routeOverlay={[{ lat: 46.948, lng: 7.447 }]} />);

    expect(
      screen.getByRole('button', { name: 'recording.routeOverlay.title', selected: true })
    ).toBeTruthy();
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

    expect(screen.getByTestId('maplibre-map')).toBeTruthy();
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
      ['an empty route overlay', { coordinates: TRACK, currentLocation: HERE, routeOverlay: [] }],
      [
        'a malformed route overlay',
        {
          coordinates: TRACK,
          currentLocation: HERE,
          routeOverlay: [{ lat: NaN, lng: 7.447 }],
        },
      ],
    ];

    it.each(cases)('survives %s', async (_label, props) => {
      await expect((async () => render(<RecordingMap {...props} />))()).resolves.not.toThrow();
      expect(screen.getByTestId('maplibre-map')).toBeTruthy();
    });
  });
});
