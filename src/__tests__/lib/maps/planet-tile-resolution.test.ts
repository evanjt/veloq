/**
 * Scenario: a 2D WebView surface takes the vector cache, so its planet source is
 * rewritten onto the `cached-vector://` protocol.
 *
 * Expected behaviour: the tiles it ends up asking for are the ones the planet
 * TileJSON names. The origin serves tiles from a dated snapshot segment and
 * answers the unversioned path with HTTP 200 and an empty body, so a rewrite
 * that fabricates `/planet/{z}/{x}/{y}.pbf` draws nothing and poisons the cache
 * with zero-length entries that then hit forever.
 */

import { rewriteVectorUrls } from '@/features/maps/components/mapStyles';
import { DARK_MATTER_STYLE } from '@/features/maps/components/darkMatterStyle';
import { tileProtocolsScript, vectorProtocolScript } from '@/features/maps/lib/htmlBuilders/shared';
import { buildSnapshotWorkerHtml } from '@/features/maps/lib/htmlBuilders/snapshotWorker';

// The page protocols are the web's transport now that both handsets intercept
// on the page's own origin, so this runs where nothing can intercept. Set at
// load, since a page built at describe time reads it before any hook runs.
import { Platform } from 'react-native';

const platform = Platform.OS;
Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
afterAll(() => Object.defineProperty(Platform, 'OS', { value: platform, configurable: true }));

const PLANET = 'https://tiles.openfreemap.org/planet';
const SNAPSHOT = `${PLANET}/20260823_080002_pt/{z}/{x}/{y}.pbf`;

type Handler = (params: { url: string }) => Promise<{ data: unknown }>;

interface CacheStub {
  match: jest.Mock;
  put: jest.Mock;
  keys: jest.Mock;
}

function evalProtocols(
  fetchImpl: jest.Mock,
  script: string = tileProtocolsScript()
): { handlers: Record<string, Handler>; cache: CacheStub } {
  const store = new Map<string, unknown>();
  const cache: CacheStub = {
    match: jest.fn(async (url: string) => store.get(url)),
    put: jest.fn(async (url: string, res: unknown) => {
      store.set(url, res);
    }),
    keys: jest.fn(async () => []),
  };
  const handlers: Record<string, Handler> = {};
  const maplibregl = {
    addProtocol: (name: string, fn: Handler) => {
      handlers[name] = fn;
    },
  };
  const caches = { open: async () => cache };
  const win: Record<string, unknown> = { _rn_log: () => {} };
  new Function('maplibregl', 'caches', 'fetch', 'window', 'Image', 'URL', script)(
    maplibregl,
    caches,
    fetchImpl,
    win,
    class {},
    { createObjectURL: () => '', revokeObjectURL: () => {} }
  );
  return { handlers, cache };
}

function tileResponse(bytes: number) {
  const body = new ArrayBuffer(bytes);
  return {
    ok: true,
    clone() {
      return this;
    },
    arrayBuffer: async () => body,
    headers: { get: () => String(bytes) },
  };
}

function jsonResponse(value: unknown) {
  return {
    ok: true,
    clone() {
      return this;
    },
    json: async () => value,
    text: async () => JSON.stringify(value),
    arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(value)).buffer,
    headers: { get: () => null },
  };
}

describe('planet vector tiles resolve through the TileJSON', () => {
  it('does not fabricate a tile path the origin serves empty', () => {
    const rewritten = JSON.parse(JSON.stringify(rewriteVectorUrls(DARK_MATTER_STYLE)));
    const source = rewritten.sources.openmaptiles;
    const templates: string[] = source.tiles ?? [];
    for (const template of templates) {
      expect(template).not.toMatch(/\/planet\/\{z\}/);
    }
    expect(source.url).toBe('cached-vector://tiles.openfreemap.org/planet');
  });

  it('serves the TileJSON with its tile template pointed back at the cache', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ tilejson: '3.0.0', tiles: [SNAPSHOT] }));
    const { handlers } = evalProtocols(fetchImpl as jest.Mock);
    const result = await handlers['cached-vector']({
      url: 'cached-vector://tiles.openfreemap.org/planet',
    });
    expect(fetchImpl).toHaveBeenCalledWith(PLANET);
    const data = result.data as { tiles: string[] };
    expect(data.tiles).toEqual([
      'cached-vector://tiles.openfreemap.org/planet/20260823_080002_pt/{z}/{x}/{y}.pbf',
    ]);
  });

  it('returns a versioned tile and caches it', async () => {
    const url = 'https://tiles.openfreemap.org/planet/20260823_080002_pt/2/2/1.pbf';
    const fetchImpl = jest.fn(async () => tileResponse(1024));
    const { handlers, cache } = evalProtocols(fetchImpl as jest.Mock);
    const result = await handlers['cached-vector']({
      url: url.replace('https://', 'cached-vector://'),
    });
    expect((result.data as ArrayBuffer).byteLength).toBe(1024);
    expect(cache.put).toHaveBeenCalled();
  });

  it('refuses to cache a zero-length tile', async () => {
    const url = 'https://tiles.openfreemap.org/planet/20260823_080002_pt/2/2/1.pbf';
    const fetchImpl = jest.fn(async () => tileResponse(0));
    const { handlers, cache } = evalProtocols(fetchImpl as jest.Mock);
    await expect(
      handlers['cached-vector']({ url: url.replace('https://', 'cached-vector://') })
    ).rejects.toThrow();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('does not serve a zero-length entry that a previous build already cached', async () => {
    const url = 'https://tiles.openfreemap.org/planet/20260823_080002_pt/2/2/1.pbf';
    const fetchImpl = jest.fn(async () => tileResponse(4096));
    const { handlers, cache } = evalProtocols(fetchImpl as jest.Mock);
    cache.match.mockImplementationOnce(async () => tileResponse(0));
    const result = await handlers['cached-vector']({
      url: url.replace('https://', 'cached-vector://'),
    });
    expect((result.data as ArrayBuffer).byteLength).toBe(4096);
  });
});

describe('one vector protocol, one page', () => {
  it("is the interactive surfaces' own, registered exactly once", () => {
    const snippet = vectorProtocolScript();
    expect(snippet).toContain("addProtocol('cached-vector'");
    expect(tileProtocolsScript()).toContain(snippet);
    expect(tileProtocolsScript().split("addProtocol('cached-vector'").length - 1).toBe(1);
  });

  it('is not registered on the worker, which no style can point at it', () => {
    expect(buildSnapshotWorkerHtml(0)).not.toContain("addProtocol('cached-vector'");
  });
});
