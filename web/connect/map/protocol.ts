// The `veloq` page protocol: what a map source names when its data lives on the
// phone. The renderer asks the handler for a URL, the handler turns it into one
// ask over the data channel, and the reply goes back in the form the renderer
// asked for. Nothing here touches the DOM, so a test drives it with a stand-in
// for the ask.
//
//   veloq://geo/<kind>/<key>?v=<revision>   GeoJSON text from the method the kind names,
//                                           answered as `{ text }`
//   veloq://heatmap-<base>/{z}/{x}/{y}      one heatmap tile as a PNG, answered as
//                                           `{ png }` in base64, or null for no heat

/** What the handler needs of the link: one ask, any method, answered with the reply's result. */
export type Ask = (method: string, params: object) => Promise<unknown>;

/** What the renderer passes a protocol handler, and takes back. */
export type Request = maplibregl.RequestParameters;
export type Response = maplibregl.ResourceResponse;

/** The scheme a source names. */
export const SCHEME = 'veloq';

/** Which method answers each kind of `geo` URL, and what it is asked. */
const GEO_KINDS: Record<string, { method: string; params: (key: string) => object }> = {
  track: { method: 'geo.track', params: (key) => ({ activityId: key }) },
  'activity-overlay': { method: 'geo.activityOverlay', params: (key) => ({ activityId: key }) },
  'route-lines': { method: 'geo.routeLines', params: () => ({}) },
  sections: { method: 'geo.sections', params: () => ({}) },
  route: { method: 'geo.route', params: (key) => ({ groupId: key }) },
  'route-latest': { method: 'geo.routeLatest', params: (key) => ({ groupId: key }) },
  section: { method: 'geo.section', params: (key) => ({ sectionId: key }) },
  'section-passes': { method: 'geo.sectionPasses', params: (key) => ({ sectionId: key }) },
};

const BASES = ['light', 'dark', 'satellite'] as const;

/** A 1 by 1 transparent PNG: the answer for a tile with no heat in it. */
const EMPTY_TILE = base64Bytes(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII='
);

/** One URL as the ask it stands for, or why it stands for none. */
export type Parsed =
  | { kind: 'geo'; method: string; params: object }
  | {
      kind: 'heatmap';
      method: 'heatmap.tile';
      params: { z: number; x: number; y: number; base: string };
    }
  | { kind: 'refused'; reason: string };

export function parse(url: string): Parsed {
  const found = /^veloq:\/\/([a-z0-9-]+)\/([^?#]*)/.exec(url);
  if (!found) return { kind: 'refused', reason: `not a ${SCHEME} url: ${url}` };
  const [, host = '', path = ''] = found;
  if (host === 'geo') {
    const [kind = '', ...rest] = path.split('/');
    const entry = GEO_KINDS[kind];
    if (!entry) return { kind: 'refused', reason: `no geo kind ${kind}` };
    return {
      kind: 'geo',
      method: entry.method,
      params: entry.params(decodeURIComponent(rest.join('/'))),
    };
  }
  const base = /^heatmap-(.+)$/.exec(host)?.[1];
  if (base !== undefined) {
    if (!(BASES as readonly string[]).includes(base)) {
      return { kind: 'refused', reason: `no heatmap base ${base}` };
    }
    const tile = path.split('/').map((part) => (/^\d+$/.test(part) ? Number(part) : NaN));
    const [z, x, y] = tile;
    if (
      tile.length !== 3 ||
      z === undefined ||
      x === undefined ||
      y === undefined ||
      tile.some(Number.isNaN)
    ) {
      return { kind: 'refused', reason: `not a tile: ${path}` };
    }
    return { kind: 'heatmap', method: 'heatmap.tile', params: { z, x, y, base } };
  }
  return { kind: 'refused', reason: `no ${SCHEME} host ${host}` };
}

function base64Bytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at++) bytes[at] = binary.charCodeAt(at);
  return bytes;
}

/** A view of exactly these bytes, which a transfer to a worker can take. */
const buffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

function aborted(): Error {
  return Object.assign(new Error('aborted'), { name: 'AbortError' });
}

/** The reply in the form the renderer asked for. */
function respond(parsed: Parsed, result: unknown, type: Request['type']): Response {
  if (parsed.kind === 'heatmap') {
    const png = (result as { png?: unknown } | null)?.png;
    if (png !== null && typeof png !== 'string') throw new Error('the phone sent no tile');
    return { data: buffer(png === null ? EMPTY_TILE : base64Bytes(png)) };
  }
  const text = (result as { text?: unknown } | null)?.text;
  if (typeof text !== 'string') throw new Error('the phone sent no GeoJSON text');
  if (type === 'json') return { data: JSON.parse(text) as unknown };
  if (type === 'string') return { data: text };
  return { data: buffer(new TextEncoder().encode(text)) };
}

/**
 * The handler for the `veloq` scheme over an ask. Asks for one URL while a
 * reply is outstanding share it. A request aborted before its reply lands
 * rejects with an abort error and takes nothing from the reply; one aborted
 * before it is sent sends nothing.
 */
export function createHandler(ask: () => Ask): maplibregl.ProtocolHandler {
  const waiting = new Map<string, Promise<unknown>>();

  return async (request, abortController) => {
    const { signal } = abortController;
    if (signal.aborted) throw aborted();
    const parsed = parse(request.url);
    if (parsed.kind === 'refused') throw new Error(parsed.reason);

    let reply = waiting.get(request.url);
    if (!reply) {
      reply = ask()(parsed.method, parsed.params).finally(() => waiting.delete(request.url));
      waiting.set(request.url, reply);
    }
    const result = await Promise.race([
      reply,
      new Promise<never>((_, reject) =>
        signal.addEventListener('abort', () => reject(aborted()), { once: true })
      ),
    ]);
    if (signal.aborted) throw aborted();
    return respond(parsed, result, request.type);
  };
}

let current: Ask | null = null;
let registered = false;

/**
 * Register the scheme with the renderer once and point it at `ask`. The
 * returned function lets go of `ask` if it is still the one in use.
 */
export function installProtocol(renderer: Pick<typeof maplibregl, 'addProtocol'>, ask: Ask) {
  current = ask;
  if (!registered) {
    registered = true;
    renderer.addProtocol(
      SCHEME,
      createHandler(() => {
        if (!current) throw new Error('not connected');
        return current;
      })
    );
  }
  return () => {
    if (current === ask) current = null;
  };
}
