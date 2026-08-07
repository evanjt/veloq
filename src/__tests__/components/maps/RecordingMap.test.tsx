/**
 * Scenario: the recording map is rendered with live GPS input that may be
 * empty, single-point or malformed.
 *
 * Expected behaviour: it always mounts, never throws, and its controls appear
 * on the documented testIDs. These assertions describe the contract every map
 * implementation has to keep, so they avoid MapLibre-specific prop shapes.
 */

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({ preferences: { defaultStyle: 'light' } }),
}));

import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { RecordingMap } from '@/features/recording/components/RecordingMap';

const TRACK: [number, number][] = [
  [46.948, 7.447],
  [46.949, 7.448],
  [46.95, 7.449],
];

const HERE = { latitude: 46.948, longitude: 7.447 };

function panTheMap() {
  fireEvent(screen.getByTestId('maplibre-map'), 'regionDidChange', {
    type: 'Feature',
    properties: { isUserInteraction: true },
    geometry: { type: 'Point', coordinates: [7.447, 46.948] },
  });
}

describe('RecordingMap', () => {
  it('mounts with a live track and a current position', () => {
    render(<RecordingMap coordinates={TRACK} currentLocation={HERE} />);

    expect(screen.getByTestId('maplibre-map')).toBeTruthy();
  });

  it('offers recentring only once the user has panned away', () => {
    render(<RecordingMap coordinates={TRACK} currentLocation={HERE} />);

    expect(screen.queryByTestId('recording-map-recenter')).toBeNull();

    panTheMap();

    expect(screen.getByTestId('recording-map-recenter')).toBeTruthy();
    fireEvent.press(screen.getByTestId('recording-map-recenter'));
    expect(screen.queryByTestId('recording-map-recenter')).toBeNull();
  });

  it('shows the route picker control only when a handler is supplied', () => {
    const onOpenRoutePicker = jest.fn();
    const { rerender } = render(<RecordingMap coordinates={TRACK} currentLocation={HERE} />);

    expect(screen.queryByTestId('recording-map-route-overlay')).toBeNull();

    rerender(
      <RecordingMap
        coordinates={TRACK}
        currentLocation={HERE}
        onOpenRoutePicker={onOpenRoutePicker}
      />
    );

    fireEvent.press(screen.getByTestId('recording-map-route-overlay'));
    expect(onOpenRoutePicker).toHaveBeenCalledTimes(1);
  });

  it('hides the controls in review mode', () => {
    render(
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
    const cases: Array<[string, React.ComponentProps<typeof RecordingMap>]> = [
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

    it.each(cases)('survives %s', (_label, props) => {
      expect(() => render(<RecordingMap {...props} />)).not.toThrow();
      expect(screen.getByTestId('maplibre-map')).toBeTruthy();
    });
  });
});
