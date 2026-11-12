/**
 * Scenario: a detail map draws the library's sections and routes, and a card push swaps the
 * subject, so the map reads the two layers again.
 *
 * Expected behaviour: the first read decodes both layers; a read under the stamps it returned
 * hands back the identical data and the engine is told which stamps are held; a layer whose stamp
 * moved is decoded again; and an engine that is not open draws nothing.
 */
import {
  createContextLayerHold,
  NO_CONTEXT_LAYER_DATA,
} from '@/features/maps/lib/contextLayerHold';
import { encodeTrack } from '../../__shared__/trackBytes';

const line = encodeTrack([
  { latitude: 46.5, longitude: 6.6 },
  { latitude: 46.51, longitude: 6.61 },
]);

const sectionLayer = (stamp: number, ids: string[] | undefined) => ({
  stamp,
  ...(ids && {
    sections: ids.map((id) => ({
      id,
      name: id,
      sportTypes: ['Ride'],
      visitCount: 3,
      distanceMeters: 1500,
      encodedPolyline: line,
    })),
  }),
});

const routeLayer = (stamp: number, generation: number, shipped: boolean) => ({
  stamp,
  generation,
  ...(shipped && { routes: [] }),
});

describe('createContextLayerHold', () => {
  it('decodes once per stamp and passes the held stamps back', () => {
    const hold = createContextLayerHold();
    const fetch = jest
      .fn()
      .mockReturnValueOnce({
        sections: sectionLayer(7, ['s1', 's2']),
        routes: routeLayer(7, 3, true),
      })
      .mockReturnValueOnce({
        sections: sectionLayer(7, undefined),
        routes: routeLayer(7, 3, false),
      });

    const first = hold.read(fetch);
    const second = hold.read(fetch);

    expect(first.sections.features.map((feature) => feature.id)).toEqual(['s1', 's2']);
    expect(first.routeGeneration).toBe(3);
    expect(fetch).toHaveBeenNthCalledWith(1, undefined, undefined);
    expect(fetch).toHaveBeenNthCalledWith(2, 7, 7);
    expect(second).toBe(first);
  });

  it('decodes a layer again once its stamp has moved', () => {
    const hold = createContextLayerHold();
    const first = hold.read(() => ({
      sections: sectionLayer(1, ['s1']),
      routes: routeLayer(1, 1, true),
    }));
    const second = hold.read(() => ({
      sections: sectionLayer(2, ['s1', 's3']),
      routes: routeLayer(2, 2, true),
    }));

    expect(second).not.toBe(first);
    expect(second.sections.features).toHaveLength(2);
    expect(second.routeGeneration).toBe(2);
  });

  it('draws nothing while the engine is not open, and forgets what it held', () => {
    const hold = createContextLayerHold();
    hold.read(() => ({ sections: sectionLayer(1, ['s1']), routes: routeLayer(1, 1, true) }));

    const closed = hold.read(() => undefined);

    expect(closed.sections.features).toEqual([]);
    expect(closed.routeGeneration).toBeUndefined();
    expect(closed).toEqual(NO_CONTEXT_LAYER_DATA);
  });
});
