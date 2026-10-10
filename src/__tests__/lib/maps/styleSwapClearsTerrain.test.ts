/**
 * Scenario: a page with terrain on swaps to a style with another sprite or
 * glyph set. The renderer builds a new style, which has no projection until
 * it loads, and a frame drawn in between runs the old terrain's depth pass
 * against it and throws from inside the renderer.
 *
 * Expected behaviour: every page's swap clears terrain before it sets the
 * style, and leaves terrain alone when none is on.
 */

import { buildMap3DSetStyleScript, buildSetStyleScript } from '@/features/maps/lib/htmlBuilders';
import { bootWorkerPage } from '../../__shared__/snapshotWorkerPage';

/** A map that records the order of its terrain and style calls. */
function recordingMap(terrainOn: boolean) {
  const calls: string[] = [];
  let terrain: unknown = terrainOn ? { source: 'terrain' } : null;
  const map = {
    getTerrain: () => terrain,
    setTerrain: (next: unknown) => {
      terrain = next;
      calls.push(`setTerrain(${JSON.stringify(next)})`);
    },
    setStyle: () => calls.push('setStyle'),
    once: () => {},
  };
  return { map, calls };
}

function runSwap(script: string, terrainOn: boolean): string[] {
  const { map, calls } = recordingMap(terrainOn);
  const win = { map, _routeCoords: [] as number[][], _veloq: { rehydrate: () => {} } };
  new Function('window', 'fetch', script)(win, () => new Promise(() => {}));
  return calls;
}

const swaps: [string, string][] = [
  ['map surface', buildSetStyleScript('satellite')],
  [
    '3D map',
    buildMap3DSetStyleScript({
      mapStyle: 'satellite',
      routeColor: '#2a9d8f',
      terrainExaggeration: 1.5,
      heatmapGeneration: 0,
      showHeatmap: false,
    }),
  ],
];

describe.each(swaps)('the %s style swap', (_name, script) => {
  it('clears terrain before it sets the style', () => {
    expect(runSwap(script, true)).toEqual(['setTerrain(null)', 'setStyle']);
  });

  it('leaves terrain alone when none is on', () => {
    expect(runSwap(script, false)).toEqual(['setStyle']);
  });
});

describe('the snapshot worker style swap', () => {
  const request = {
    activityId: 'kayak-loop',
    coordinates: [
      [8.5, 47.4],
      [8.6, 47.5],
    ] as [number, number][],
    camera: { center: [8.55, 47.45] as [number, number], zoom: 12, bearing: 0, pitch: 60 },
    mapStyle: 'satellite' as const,
    routeColor: '#2a9d8f',
  };

  it('clears terrain before it sets the style', () => {
    const page = bootWorkerPage();
    page.map.getTerrain.mockReturnValue({ source: 'terrain' });

    page.render(request, 1);

    expect(page.map.setTerrain).toHaveBeenCalledWith(null);
    expect(page.map.setStyle).toHaveBeenCalledTimes(1);
    expect(page.map.setTerrain.mock.invocationCallOrder[0]).toBeLessThan(
      page.map.setStyle.mock.invocationCallOrder[0]
    );
  });

  it('leaves terrain alone when none is on', () => {
    const page = bootWorkerPage();

    page.render(request, 1);

    expect(page.map.setTerrain).not.toHaveBeenCalled();
    expect(page.map.setStyle).toHaveBeenCalledTimes(1);
  });
});
