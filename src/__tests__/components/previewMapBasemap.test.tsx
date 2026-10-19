/**
 * Scenario: the detection preview map under an athlete whose global basemap is
 * satellite.
 * Expected behaviour: this screen is a diff tool, so the basemap's only job is
 * to give the lines somewhere to sit. It takes the street style whatever the
 * global preference is, following the theme rather than the preference.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { PreviewMapView } from '@/features/routes/components/preview/PreviewMapView';

const capturedStyles: string[] = [];

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    decodeCoords: () => [
      { longitude: 8.7, latitude: 47.5 },
      { longitude: 8.71, latitude: 47.51 },
    ],
  })
);

jest.mock('@/features/maps', () => {
  const { View } = require('react-native');
  return {
    // The real feature, so the coordinate helpers and the credit line under
    // test are the shipped ones. Only the surface is stood in for.
    ...jest.requireActual('@/features/maps'),
    MapSurface: ({ mapStyle }: { mapStyle: string }) => {
      capturedStyles.push(mapStyle);
      return <View testID="map-surface" />;
    },
  };
});

const mockGetGlobalMapStyle = jest.fn(() => 'satellite');
const mockSetGlobalMapStyle = jest.fn();

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    getGlobalMapStyle: () => mockGetGlobalMapStyle(),
    setGlobalMapStyle: mockSetGlobalMapStyle,
  }),
}));

let mockIsDark = false;
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: mockIsDark }) }));

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const CENTRE = { binKey: '9:27', lat: 47.5, lng: 8.7 };

function renderMap() {
  return render(
    <PreviewMapView
      result={null}
      currentSections={[]}
      centre={CENTRE}
      selectedId={null}
      showCurrent
      showProposed
      showRemoved
      onToggleCurrent={jest.fn()}
      onToggleProposed={jest.fn()}
      onToggleRemoved={jest.fn()}
      onSelect={jest.fn()}
    />
  );
}

describe('the detection preview basemap', () => {
  beforeEach(() => {
    capturedStyles.length = 0;
    mockIsDark = false;
    mockGetGlobalMapStyle.mockClear();
    mockSetGlobalMapStyle.mockClear();
  });

  it('takes the street style even when the athlete rides on satellite', async () => {
    await renderMap();

    expect(capturedStyles[0]).toBe('light');
  });

  it('follows the theme rather than the global preference', async () => {
    mockIsDark = true;
    await renderMap();

    expect(capturedStyles[0]).toBe('dark');
  });

  it('does not read the global preference at all', async () => {
    await renderMap();

    expect(mockGetGlobalMapStyle).not.toHaveBeenCalled();
  });

  it('credits the street basemap, not the satellite imagery underneath nothing', async () => {
    const tree = await renderMap();

    expect(tree.getByTestId('map-attribution-text').props.children).toBe(
      '© OpenFreeMap · © OpenMapTiles · © OpenStreetMap'
    );
  });
});

/**
 * The ground a proposed section runs over is a question the street style
 * cannot answer, so the athlete can switch. The choice is this screen's, not
 * the app's: nothing here writes the global preference.
 */
describe('the preview basemap cycler', () => {
  beforeEach(() => {
    capturedStyles.length = 0;
    mockIsDark = false;
    mockSetGlobalMapStyle.mockClear();
  });

  function latestStyle() {
    return capturedStyles[capturedStyles.length - 1];
  }

  it('moves off the street style on a tap', async () => {
    const tree = await renderMap();

    await fireEvent.press(tree.getByTestId('preview-map-style'));

    expect(latestStyle()).toBe('dark');
  });

  it('reaches satellite on the first tap under a dark theme', async () => {
    mockIsDark = true;
    const tree = await renderMap();

    await fireEvent.press(tree.getByTestId('preview-map-style'));

    expect(latestStyle()).toBe('satellite');
  });

  it('leaves the global preference alone', async () => {
    const tree = await renderMap();

    await fireEvent.press(tree.getByTestId('preview-map-style'));
    await fireEvent.press(tree.getByTestId('preview-map-style'));

    expect(mockSetGlobalMapStyle).not.toHaveBeenCalled();
    expect(mockGetGlobalMapStyle).not.toHaveBeenCalled();
  });

  it('opens on street again on the next visit', async () => {
    mockIsDark = true;
    const first = await renderMap();
    await fireEvent.press(first.getByTestId('preview-map-style'));
    await first.unmount();

    capturedStyles.length = 0;
    await renderMap();

    expect(capturedStyles[0]).toBe('dark');
  });

  // The imagery source is whichever one covers the viewport, so the assertion
  // is that the credit followed the switch, not which provider it names.
  it('credits the imagery the athlete switched to', async () => {
    mockIsDark = true;
    const tree = await renderMap();

    await fireEvent.press(tree.getByTestId('preview-map-style'));

    const credit = tree.getByTestId('map-attribution-text').props.children;
    expect(credit).not.toContain('OpenFreeMap');
    expect(credit.length).toBeGreaterThan(0);
  });
});
