/**
 * Scenario: the route grouping preview draws a basemap behind today's routes.
 * Expected behaviour: the map credits the source of the basemap it draws, and
 * over satellite imagery the credit follows the viewport to the regional
 * source actually drawn there.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';
import { GroupingPreviewMap } from '@/features/routes/components/preview/GroupingPreviewMap';
import { MAP_ATTRIBUTIONS } from '@/features/maps/components/mapStyles';
import type { MapCameraState, MapSurfaceProps } from '@/features/maps/components/MapSurface';

const mockSurfaceProps: MapSurfaceProps[] = [];

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('@/features/maps', () => {
  const ReactActual = jest.requireActual<typeof React>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    // The real feature, so the credit line under test is the shipped one. Only
    // the surface is stood in for.
    ...jest.requireActual('@/features/maps'),
    MapSurface: ReactActual.forwardRef((props: MapSurfaceProps, _ref: React.Ref<unknown>) => {
      mockSurfaceProps.push(props);
      return <View testID="map-surface" />;
    }),
  };
});

jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: false }) }));

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

/** A town on the Aare, inside the national imagery's box. */
const AARE_TOWN = { lat: 46.948, lng: 7.447 };

function settle(center: [number, number], zoom: number) {
  const state: MapCameraState = {
    center,
    zoom,
    bearing: 0,
    pitch: 0,
    bounds: {
      sw: [center[0] - 0.01, center[1] - 0.01],
      ne: [center[0] + 0.01, center[1] + 0.01],
    },
  };
  act(() => {
    mockSurfaceProps[mockSurfaceProps.length - 1].onRegionDidChange?.(state, true);
  });
}

beforeEach(() => {
  mockSurfaceProps.length = 0;
});

describe('GroupingPreviewMap', () => {
  it('credits the street basemap it draws', async () => {
    const tree = await render(
      <GroupingPreviewMap
        routes={[]}
        centre={AARE_TOWN}
        painted={[]}
        mergedCount={0}
        mapStyle="light"
      />
    );

    expect(tree.getByTestId('map-attribution-text').props.children).toBe(MAP_ATTRIBUTIONS.light);
  });

  it('credits the satellite source drawn where the camera settles', async () => {
    const tree = await render(
      <GroupingPreviewMap
        routes={[]}
        centre={AARE_TOWN}
        painted={[]}
        mergedCount={0}
        mapStyle="satellite"
      />
    );

    settle([AARE_TOWN.lng, AARE_TOWN.lat], 15);
    expect(tree.getByTestId('map-attribution-text').props.children).toContain('swisstopo');

    settle([-40, 0], 15);
    expect(tree.getByTestId('map-attribution-text').props.children).not.toContain('swisstopo');
  });
});
