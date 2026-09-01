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
import { tileProtocolsScript } from '@/features/maps/lib/htmlBuilders/shared';
import { buildSnapshotWorkerHtml } from '@/features/maps/lib/htmlBuilders/snapshotWorker';

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
  // eslint-disable-next-line no-new-func
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

/**
 * The snapshot worker registers its own `cached-vector` handler over the same
 * `veloq-vector-v1` cache, so an empty body it stores is one the interactive
 * surfaces serve. Its copy has to hold the same contract.
 */
describe('the snapshot worker holds the same vector contract', () => {
  function workerProtocolScript(): string {
    const html = buildSnapshotWorkerHtml();
    const start = html.indexOf("var VECTOR_CACHE = 'veloq-vector-v1';");
    expect(start).toBeGreaterThan(-1);
    const end = html.indexOf('// Cache eviction', start);
    expect(end).toBeGreaterThan(start);
    return 'function maybeEvict() {}\n' + html.substring(start, end);
  }

  it('refuses to cache a zero-length tile', async () => {
    const url = 'cached-vector://tiles.openfreemap.org/planet/20260823_080002_pt/2/2/1.pbf';
    const fetchImpl = jest.fn(async () => tileResponse(0));
    const { handlers, cache } = evalProtocols(fetchImpl as jest.Mock, workerProtocolScript());
    await expect(handlers['cached-vector']({ url })).rejects.toThrow();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it('rewrites the TileJSON tile template back onto the protocol', async () => {
    const fetchImpl = jest.fn(async () => jsonResponse({ tilejson: '3.0.0', tiles: [SNAPSHOT] }));
    const { handlers } = evalProtocols(fetchImpl as jest.Mock, workerProtocolScript());
    const result = await handlers['cached-vector']({
      url: 'cached-vector://tiles.openfreemap.org/planet',
    });
    expect((result.data as { tiles: string[] }).tiles[0]).toContain('20260823_080002_pt');
  });
});
