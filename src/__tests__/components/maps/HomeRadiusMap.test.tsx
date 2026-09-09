/**
 * Scenario: the export privacy row shows the home it guessed, and the athlete
 * is the only one who knows whether the guess is on their street or the next.
 *
 * Expected behaviour: the map draws the home as a point and the radius as a
 * circle on the ground, fits the camera to that circle, refits when the radius
 * changes, and relays a tap as the new home. Both sources stay declared when
 * there is no circle to draw.
 */

import React from 'react';
import { render, act } from '@testing-library/react-native';

import { HomeRadiusMap } from '@/features/maps/components/HomeRadiusMap';
import { haversineDistance } from '@/shared/geo/distance';
import type { LngLat } from '@/features/maps/lib/coordinates';
import type { MapSurfaceProps } from '@/features/maps/components/MapSurface';

const mockSurfaceProps: MapSurfaceProps[] = [];
const mockSetCamera = jest.fn();

jest.mock('@/features/maps/components/MapSurface', () => {
  const ReactActual = jest.requireActual<typeof React>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    MapSurface: ReactActual.forwardRef((props: MapSurfaceProps, ref: React.Ref<unknown>) => {
      ReactActual.useImperativeHandle(ref, () => ({ setCamera: mockSetCamera }));
      mockSurfaceProps.push(props);
      return <View testID="maplibre-map" />;
    }),
  };
});

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const HOME: LngLat = [7.36, 46.2333];

function last(): MapSurfaceProps {
  return mockSurfaceProps[mockSurfaceProps.length - 1];
}

function boundsOf(camera: MapSurfaceProps['initialCamera']) {
  if (!camera.bounds) throw new Error('camera has no bounds');
  return camera.bounds;
}

function geojson(props: MapSurfaceProps, id: string): GeoJSON.FeatureCollection {
  const source = props.sources[id];
  if (source.kind !== 'geojson') throw new Error(`${id} is not geojson`);
  return source.data as GeoJSON.FeatureCollection;
}

beforeEach(() => {
  mockSurfaceProps.length = 0;
  mockSetCamera.mockClear();
});

describe('HomeRadiusMap', () => {
  it('draws the home as a point at the coordinate it was given', () => {
    render(<HomeRadiusMap home={HOME} radiusM={100} onMove={jest.fn()} />);

    const point = geojson(last(), 'home-point').features[0];
    expect(point.geometry).toEqual({ type: 'Point', coordinates: HOME });
  });

  it('draws the radius as a circle on the ground, sized in metres', () => {
    render(<HomeRadiusMap home={HOME} radiusM={250} onMove={jest.fn()} />);

    const circle = geojson(last(), 'home-radius').features[0];
    expect(circle.geometry.type).toBe('Polygon');
    const ring = (circle.geometry as GeoJSON.Polygon).coordinates[0];
    for (const [lng, lat] of ring) {
      expect(haversineDistance(HOME[1], HOME[0], lat, lng)).toBeCloseTo(250, -1);
    }
  });

  it('fits the camera to the circle and refuses to zoom past street level', () => {
    render(<HomeRadiusMap home={HOME} radiusM={100} onMove={jest.fn()} />);

    const camera = last().initialCamera;
    expect(boundsOf(camera).sw[1]).toBeLessThan(HOME[1]);
    expect(boundsOf(camera).ne[1]).toBeGreaterThan(HOME[1]);
    expect(camera.maxZoom).toBeDefined();
  });

  it('refits when the radius changes so a wider circle stays in frame', () => {
    const tree = render(<HomeRadiusMap home={HOME} radiusM={100} onMove={jest.fn()} />);
    expect(mockSetCamera).not.toHaveBeenCalled();

    tree.rerender(<HomeRadiusMap home={HOME} radiusM={500} onMove={jest.fn()} />);

    expect(mockSetCamera).toHaveBeenCalledTimes(1);
    const bounds = boundsOf(mockSetCamera.mock.calls[0][0]);
    expect(haversineDistance(bounds.sw[1], HOME[0], bounds.ne[1], HOME[0])).toBeCloseTo(1000, -2);
  });

  it('relays a tap as the new home', () => {
    const onMove = jest.fn();
    render(<HomeRadiusMap home={HOME} radiusM={100} onMove={onMove} />);

    const moved: LngLat = [7.3612, 46.2341];
    act(() => last().onPress?.({ coordinate: moved, point: [10, 10], feature: null }));

    expect(onMove).toHaveBeenCalledWith(moved);
  });

  it('keeps both sources declared with no circle when the radius is zero', () => {
    render(<HomeRadiusMap home={HOME} radiusM={0} onMove={jest.fn()} />);

    expect(geojson(last(), 'home-radius').features).toHaveLength(0);
    expect(geojson(last(), 'home-point').features).toHaveLength(1);
    expect(last().layers.map((l) => l.source)).toEqual(
      expect.arrayContaining(['home-radius', 'home-point'])
    );
  });

  it('leaves panning off so the settings list underneath still scrolls', () => {
    render(<HomeRadiusMap home={HOME} radiusM={100} onMove={jest.fn()} />);

    expect(last().scrollEnabled).toBe(false);
    expect(last().zoomEnabled).not.toBe(false);
  });
});
