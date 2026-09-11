/**
 * Scenario: the recording map had no style of its own. It passed
 * `preferences.defaultStyle` straight through, so a satellite chosen once for
 * looking at a heatmap became the map the athlete navigated a ride by.
 *
 * Expected behaviour: it opens on the theme's vector style whatever the
 * browsing preference is, the athlete can cycle to satellite in place, that
 * choice outlives a remount, and with the radio off a satellite choice draws
 * the vector basemap rather than a grey grid.
 */

import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';

import {
  RecordingMap,
  __resetRecordingMapStyle,
} from '@/features/recording/components/RecordingMap';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

const preferences = { defaultStyle: 'satellite' };
const theme = { isDark: false };
const network = { isOnline: true };

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({ preferences }),
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => theme,
}));

jest.mock('@/shared/app/NetworkContext', () => ({
  useIsOnline: () => network.isOnline,
}));

const drawn: string[] = [];

jest.mock('@/features/maps/components/MapSurface', () => {
  const ReactLocal = require('react');
  const { View } = require('react-native');
  return {
    MapSurface: ReactLocal.forwardRef((props: { mapStyle: string }, _ref: unknown) => {
      drawn.push(props.mapStyle);
      return ReactLocal.createElement(View, { testID: 'maplibre-map' });
    }),
  };
});

const TRACK: [number, number][] = [
  [46.948, 7.447],
  [46.949, 7.448],
];
const HERE = { latitude: 46.948, longitude: 7.447 };

/** The style the surface was last asked to draw. */
function lastDrawn(): string | undefined {
  return drawn[drawn.length - 1];
}

describe('the recording map picks its own basemap', () => {
  beforeEach(() => {
    drawn.length = 0;
    preferences.defaultStyle = 'satellite';
    theme.isDark = false;
    network.isOnline = true;
    __resetRecordingMapStyle();
  });

  it('opens on the theme style, not the browsing preference', () => {
    render(<RecordingMap coordinates={TRACK} currentLocation={HERE} />);

    expect(lastDrawn()).toBe('light');
  });

  it('follows the theme rather than hard-coding light', () => {
    theme.isDark = true;
    render(<RecordingMap coordinates={TRACK} currentLocation={HERE} />);

    expect(lastDrawn()).toBe('dark');
  });

  it('cycles to another style in place', () => {
    render(<RecordingMap coordinates={TRACK} currentLocation={HERE} />);
    const before = lastDrawn();

    fireEvent.press(screen.getByTestId('recording-map-style'));

    expect(lastDrawn()).not.toBe(before);
  });

  it('keeps the athlete choice across a remount, because a ride is long', () => {
    const first = render(<RecordingMap coordinates={TRACK} currentLocation={HERE} />);
    fireEvent.press(screen.getByTestId('recording-map-style'));
    const chosen = lastDrawn();
    first.unmount();

    render(<RecordingMap coordinates={TRACK} currentLocation={HERE} />);

    expect(lastDrawn()).toBe(chosen);
  });

  it('draws the vector basemap when satellite is chosen with no connection', () => {
    const view = render(<RecordingMap coordinates={TRACK} currentLocation={HERE} />);
    // Cycle until satellite is the choice, then take the radio away.
    for (let i = 0; i < 4 && lastDrawn() !== 'satellite'; i += 1) {
      fireEvent.press(screen.getByTestId('recording-map-style'));
    }
    expect(lastDrawn()).toBe('satellite');

    // The component is memoised and `useIsOnline` is a plain stub here, so the
    // redraw is forced with a new point rather than by the context that does it
    // in the app.
    network.isOnline = false;
    view.rerender(<RecordingMap coordinates={[...TRACK, [46.95, 7.449]]} currentLocation={HERE} />);

    expect(lastDrawn()).not.toBe('satellite');
  });

  it('shows no style control in review mode, where the ride is over', () => {
    render(<RecordingMap coordinates={TRACK} currentLocation={HERE} fitBounds />);

    expect(screen.queryByTestId('recording-map-style')).toBeNull();
  });
});
