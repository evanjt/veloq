/**
 * Scenario: the athlete zooms into one street, then drags a grouping knob. The
 * preview answers with the same routes painted again.
 * Expected behaviour: the map keeps the athlete's pan and zoom. It refits only
 * when the area or the framed routes change, and it decodes each route's line
 * once rather than on every answer.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { decodeCoords } from 'veloqrs';
import {
  GroupingPreviewMap,
  type GroupingRoute,
} from '@/features/routes/components/preview/GroupingPreviewMap';
import type { PaintedRoute } from '@/features/routes/lib/groupingParams';
import type { MapSurfaceProps, MapSurfaceRef } from '@/features/maps/components/MapSurface';

const mockFitBounds = jest.fn();

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

jest.mock('@/features/maps', () => {
  const ReactActual = jest.requireActual<typeof React>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    ...jest.requireActual('@/features/maps'),
    MapSurface: ReactActual.forwardRef((_props: MapSurfaceProps, ref: React.Ref<unknown>) => {
      ReactActual.useImperativeHandle(
        ref,
        () => ({ fitBounds: mockFitBounds }) as unknown as MapSurfaceRef
      );
      return <View testID="map-surface" />;
    }),
  };
});

jest.mock('@/shared/app/useTheme', () => ({
  useTheme: () => ({ isDark: false }),
}));

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

/** A town on the Aare, inside the national imagery's box. */
const AARE_TOWN = { lat: 46.948, lng: 7.447 };
const FAR_TOWN = { lat: -33.9, lng: 151.2 };

const LOOP: GroupingRoute = {
  groupId: 'loop',
  encodedPolyline: new ArrayBuffer(8),
  bounds: { minLat: 46.9, maxLat: 47.02, minLng: 7.38, maxLng: 7.52 },
};
const COMMUTE: GroupingRoute = {
  groupId: 'commute',
  encodedPolyline: new ArrayBuffer(8),
  bounds: { minLat: 46.94, maxLat: 46.96, minLng: 7.44, maxLng: 7.6 },
};

const PAINT_LOOP: PaintedRoute = {
  groupId: 'loop',
  previewKey: 'a',
  previewSize: 2,
  isLargest: true,
  mergesWithAnother: false,
  splits: false,
};

beforeEach(() => {
  mockFitBounds.mockClear();
  jest.mocked(decodeCoords).mockReset();
  jest.mocked(decodeCoords).mockReturnValue([
    { latitude: 46.94, longitude: 7.44 },
    { latitude: 46.95, longitude: 7.45 },
  ]);
});

describe('GroupingPreviewMap camera', () => {
  it('keeps the viewport when a knob answer repaints the same routes', () => {
    const tree = render(
      <GroupingPreviewMap
        routes={[LOOP, COMMUTE]}
        centre={AARE_TOWN}
        painted={[]}
        mergedCount={0}
        mapStyle="light"
      />
    );
    expect(mockFitBounds).toHaveBeenCalledTimes(1);

    tree.rerender(
      <GroupingPreviewMap
        routes={[LOOP, COMMUTE]}
        centre={AARE_TOWN}
        painted={[PAINT_LOOP]}
        mergedCount={1}
        mapStyle="light"
      />
    );

    expect(mockFitBounds).toHaveBeenCalledTimes(1);
  });

  vaultIt('refits when the athlete chooses another area', () => {
    const tree = render(
      <GroupingPreviewMap
        routes={[LOOP, COMMUTE]}
        centre={AARE_TOWN}
        painted={[]}
        mergedCount={0}
        mapStyle="light"
      />
    );

    tree.rerender(
      <GroupingPreviewMap
        routes={[LOOP, COMMUTE]}
        centre={FAR_TOWN}
        painted={[]}
        mergedCount={0}
        mapStyle="light"
      />
    );

    expect(mockFitBounds).toHaveBeenCalledTimes(2);
  });

  it('refits when the routes for the area land after the first paint', () => {
    const tree = render(
      <GroupingPreviewMap
        routes={[]}
        centre={AARE_TOWN}
        painted={[]}
        mergedCount={0}
        mapStyle="light"
      />
    );
    expect(mockFitBounds).toHaveBeenCalledTimes(1);

    tree.rerender(
      <GroupingPreviewMap
        routes={[LOOP, COMMUTE]}
        centre={AARE_TOWN}
        painted={[]}
        mergedCount={0}
        mapStyle="light"
      />
    );

    expect(mockFitBounds).toHaveBeenCalledTimes(2);
  });

  vaultIt('decodes each route line once across knob answers', () => {
    // Fresh buffers, since a line decoded by an earlier test stays cached.
    const routes = [
      { ...LOOP, encodedPolyline: new ArrayBuffer(8) },
      { ...COMMUTE, encodedPolyline: new ArrayBuffer(8) },
    ];
    const tree = render(
      <GroupingPreviewMap
        routes={routes}
        centre={AARE_TOWN}
        painted={[]}
        mergedCount={0}
        mapStyle="light"
      />
    );
    expect(decodeCoords).toHaveBeenCalledTimes(2);

    tree.rerender(
      <GroupingPreviewMap
        routes={[...routes]}
        centre={AARE_TOWN}
        painted={[PAINT_LOOP]}
        mergedCount={1}
        mapStyle="light"
      />
    );

    expect(decodeCoords).toHaveBeenCalledTimes(2);
  });
});
