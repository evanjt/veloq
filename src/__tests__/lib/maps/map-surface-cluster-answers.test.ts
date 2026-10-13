/**
 * Scenario: a tap lands on a cluster and the native side asks the page for the
 * cluster's leaves or its expansion zoom. The bundled MapLibre answers both as
 * Promises and ignores any trailing callback argument.
 *
 * Expected behaviour: the page posts an answer for every request, the features
 * or zoom when the Promise resolves and the empty answer when it rejects, so
 * the caller awaiting it on the native side always settles.
 */
import vm from 'vm';

import { surfaceRuntimeScript } from '@/features/maps/lib/htmlBuilders/mapSurfaceScripts';
import type { MapSurfaceHtmlConfig } from '@/features/maps/lib/htmlBuilders/mapSurface';

type Posted = Record<string, unknown>;

const config: MapSurfaceHtmlConfig = {
  style: 'light',
  camera: { center: [7.448, 46.949], zoom: 12 },
  interaction: { scroll: true, zoom: true, rotate: true, pitch: false },
  devicePixelRatio: 2,
  reduceMotion: false,
  regionChangeThrottleMs: 100,
  longPressMs: 500,
};

const LEAF = {
  type: 'Feature',
  properties: { id: 'orchard-7' },
  geometry: { type: 'Point', coordinates: [7.4, 46.9] },
};

/** A geojson source shaped like the bundled renderer's: Promises, no callbacks. */
function promiseSource(outcome: 'resolve' | 'reject') {
  const settle = <T>(value: T) =>
    outcome === 'resolve' ? Promise.resolve(value) : Promise.reject(new Error('worker gone'));
  return {
    getClusterLeaves: jest.fn((_id: number, _limit: number, _offset: number) => settle([LEAF])),
    getClusterExpansionZoom: jest.fn((_id: number) => settle(14)),
  };
}

function runPage(source: unknown) {
  const posted: Posted[] = [];
  const window: Record<string, unknown> = {
    ReactNativeWebView: { postMessage: (message: string) => posted.push(JSON.parse(message)) },
    map: { getSource: () => source },
  };
  const context = vm.createContext({ window, setTimeout, clearTimeout, console });
  vm.runInContext(surfaceRuntimeScript(config), context);
  const veloq = window._veloq as Record<string, (...args: unknown[]) => void>;
  return { posted, veloq };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('the page answers cluster requests from a Promise-only source', () => {
  it('posts the leaves when the source resolves', async () => {
    const source = promiseSource('resolve');
    const { posted, veloq } = runPage(source);

    veloq.clusterLeaves('req_1', 'clusters', 7, 100, 0);
    await flush();

    expect(source.getClusterLeaves).toHaveBeenCalledWith(7, 100, 0);
    expect(posted).toEqual([
      {
        type: 'clusterLeaves',
        requestId: 'req_1',
        features: [{ properties: LEAF.properties, geometry: LEAF.geometry }],
      },
    ]);
  });

  it('posts no leaves when the source rejects', async () => {
    const { posted, veloq } = runPage(promiseSource('reject'));

    veloq.clusterLeaves('req_2', 'clusters', 7, 100, 0);
    await flush();

    expect(posted).toEqual([{ type: 'clusterLeaves', requestId: 'req_2', features: [] }]);
  });

  it('posts the expansion zoom when the source resolves', async () => {
    const source = promiseSource('resolve');
    const { posted, veloq } = runPage(source);

    veloq.clusterExpansionZoom('req_3', 'clusters', 7);
    await flush();

    expect(source.getClusterExpansionZoom).toHaveBeenCalledWith(7);
    expect(posted).toEqual([{ type: 'clusterExpansionZoom', requestId: 'req_3', zoom: 14 }]);
  });

  it('posts a null zoom when the source rejects', async () => {
    const { posted, veloq } = runPage(promiseSource('reject'));

    veloq.clusterExpansionZoom('req_4', 'clusters', 7);
    await flush();

    expect(posted).toEqual([{ type: 'clusterExpansionZoom', requestId: 'req_4', zoom: null }]);
  });

  it('posts the empty answers when the source is missing', async () => {
    const { posted, veloq } = runPage(undefined);

    veloq.clusterLeaves('req_5', 'clusters', 7, 100, 0);
    veloq.clusterExpansionZoom('req_6', 'clusters', 7);
    await flush();

    expect(posted).toEqual([
      { type: 'clusterLeaves', requestId: 'req_5', features: [] },
      { type: 'clusterExpansionZoom', requestId: 'req_6', zoom: null },
    ]);
  });
});
