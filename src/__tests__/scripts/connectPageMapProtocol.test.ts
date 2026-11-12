/**
 * Scenario: a map source on the connect page names data that lives on the
 * phone with a `veloq` URL, and the renderer asks the protocol handler for it.
 *
 * Expected behaviour: each URL shape becomes the one ask it stands for. A
 * geo URL answers the method's GeoJSON text in the form the renderer asked
 * for. A heatmap URL answers the PNG bytes of a base64 result, and a tile with
 * no heat answers an empty transparent tile. A URL that stands for no ask is
 * refused without asking. A request aborted before its reply rejects as
 * aborted and the reply is dropped; one aborted before it is sent sends
 * nothing. Requests for one URL in flight share one ask.
 */

import { createHandler, installProtocol, parse, type Ask } from '../../../web/connect/map/protocol';

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const PNG_BASE64 = Buffer.from(PNG).toString('base64');

function fake(reply: (method: string, params: object) => Promise<unknown>) {
  const asked: { method: string; params: object }[] = [];
  const ask: Ask = (method, params) => {
    asked.push({ method, params });
    return reply(method, params);
  };
  return { asked, handler: createHandler(() => ask) };
}

const request = (url: string, type?: 'json' | 'string' | 'arrayBuffer' | 'image') =>
  type ? { url, type } : { url };

describe('the veloq page protocol urls', () => {
  it.each([
    ['veloq://geo/track/ride-1?v=3', 'geo.track', { activityId: 'ride-1' }],
    ['veloq://geo/track/a%2Fb?v=1', 'geo.track', { activityId: 'a/b' }],
    ['veloq://geo/activity-overlay/ride-1', 'geo.activityOverlay', { activityId: 'ride-1' }],
    ['veloq://geo/route-lines/all?v=7', 'geo.routeLines', {}],
    ['veloq://geo/sections/all?v=2', 'geo.sections', {}],
  ])('%s is %s', (url, method, params) => {
    expect(parse(url)).toEqual({ kind: 'geo', method, params });
  });

  it('reads a heatmap url as a tile on a base', () => {
    expect(parse('veloq://heatmap-dark/12/2145/1432')).toEqual({
      kind: 'heatmap',
      method: 'heatmap.tile',
      params: { z: 12, x: 2145, y: 1432, base: 'dark' },
    });
  });

  it.each([
    'https://tiles.openfreemap.org/planet',
    'veloq://geo/unknown/all',
    'veloq://elsewhere/1/2/3',
    'veloq://heatmap-sepia/1/0/0',
    'veloq://heatmap-light/1/0',
    'veloq://heatmap-light/1/0/0/0',
    'veloq://heatmap-light/a/0/0',
    'veloq://heatmap-light/-1/0/0',
  ])('refuses %s', (url) => {
    expect(parse(url).kind).toBe('refused');
  });
});

describe('the veloq page protocol handler', () => {
  it('answers a geo url as the parsed GeoJSON when the renderer asks for JSON', async () => {
    const collection = { type: 'FeatureCollection', features: [] };
    const { asked, handler } = fake(async () => JSON.stringify(collection));
    const reply = await handler(
      request('veloq://geo/route-lines/all?v=1', 'json'),
      new AbortController()
    );
    expect(reply.data).toEqual(collection);
    expect(asked).toEqual([{ method: 'geo.routeLines', params: {} }]);
  });

  it('answers a geo url as the text, or its bytes, when the renderer asks for those', async () => {
    const text = '{"type":"FeatureCollection","features":[]}';
    const { handler } = fake(async () => text);
    expect(
      (await handler(request('veloq://geo/sections/all', 'string'), new AbortController())).data
    ).toBe(text);
    const bytes = (
      await handler(request('veloq://geo/sections/all', 'arrayBuffer'), new AbortController())
    ).data as ArrayBuffer;
    expect(new TextDecoder().decode(bytes)).toBe(text);
  });

  it('answers a heatmap tile as the PNG bytes of the base64 result', async () => {
    const { asked, handler } = fake(async () => PNG_BASE64);
    const reply = await handler(
      request('veloq://heatmap-light/4/8/5', 'arrayBuffer'),
      new AbortController()
    );
    expect(new Uint8Array(reply.data as ArrayBuffer)).toEqual(PNG);
    expect(asked).toEqual([
      { method: 'heatmap.tile', params: { z: 4, x: 8, y: 5, base: 'light' } },
    ]);
  });

  it('answers a tile with no heat as an empty transparent PNG', async () => {
    const { handler } = fake(async () => null);
    const reply = await handler(
      request('veloq://heatmap-dark/4/8/5', 'arrayBuffer'),
      new AbortController()
    );
    const bytes = new Uint8Array(reply.data as ArrayBuffer);
    expect([...bytes.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(bytes.length).toBeLessThan(100);
  });

  it('rejects a reply that is not what the url stands for', async () => {
    const tile = fake(async () => ({ not: 'a tile' }));
    await expect(
      tile.handler(request('veloq://heatmap-dark/4/8/5'), new AbortController())
    ).rejects.toThrow('no tile');
    const geo = fake(async () => null);
    await expect(
      geo.handler(request('veloq://geo/sections/all'), new AbortController())
    ).rejects.toThrow('no GeoJSON');
  });

  it("passes on the phone's refusal", async () => {
    const { handler } = fake(async () => {
      throw new Error('unknown method heatmap.tile');
    });
    await expect(
      handler(request('veloq://heatmap-dark/4/8/5'), new AbortController())
    ).rejects.toThrow('unknown method');
  });

  it('refuses a url that stands for no ask without asking', async () => {
    const { asked, handler } = fake(async () => '{}');
    await expect(
      handler(request('veloq://geo/unknown/all'), new AbortController())
    ).rejects.toThrow('no geo kind unknown');
    expect(asked).toEqual([]);
  });

  it('sends nothing for a request aborted before it is sent', async () => {
    const { asked, handler } = fake(async () => '{}');
    const abort = new AbortController();
    abort.abort();
    await expect(handler(request('veloq://geo/sections/all'), abort)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(asked).toEqual([]);
  });

  it('rejects as aborted when the request is aborted before the reply, and drops the reply', async () => {
    let answer: (value: unknown) => void = () => {};
    const { asked, handler } = fake(() => new Promise((resolve) => (answer = resolve)));
    const abort = new AbortController();
    const settled = handler(request('veloq://heatmap-dark/4/8/5'), abort);
    abort.abort();
    await expect(settled).rejects.toMatchObject({ name: 'AbortError' });
    answer(PNG_BASE64);
    await Promise.resolve();
    expect(asked).toHaveLength(1);
  });

  it('shares one ask between requests for a url in flight, and asks again after the reply', async () => {
    const answers: ((value: unknown) => void)[] = [];
    const { asked, handler } = fake(() => new Promise((resolve) => answers.push(resolve)));
    const url = 'veloq://heatmap-dark/4/8/5';
    const first = handler(request(url), new AbortController());
    const second = handler(request(url), new AbortController());
    expect(asked).toHaveLength(1);
    answers[0]?.(PNG_BASE64);
    await Promise.all([first, second]);
    const third = handler(request(url), new AbortController());
    expect(asked).toHaveLength(2);
    answers[1]?.(null);
    await third;
  });

  it('keeps an ask for a url when another request for it is aborted', async () => {
    let answer: (value: unknown) => void = () => {};
    const { asked, handler } = fake(() => new Promise((resolve) => (answer = resolve)));
    const url = 'veloq://heatmap-dark/4/8/5';
    const aborted = new AbortController();
    const dropped = handler(request(url), aborted);
    const kept = handler(request(url), new AbortController());
    aborted.abort();
    await expect(dropped).rejects.toMatchObject({ name: 'AbortError' });
    answer(PNG_BASE64);
    expect(new Uint8Array((await kept).data as ArrayBuffer)).toEqual(PNG);
    expect(asked).toHaveLength(1);
  });
});

describe('installing the scheme', () => {
  it('registers the renderer once however many panes mount, and follows the latest ask', async () => {
    const registered: Record<string, maplibregl.ProtocolHandler> = {};
    const renderer = {
      addProtocol: jest.fn((scheme: string, handler: maplibregl.ProtocolHandler) => {
        registered[scheme] = handler;
      }),
    };
    const first = jest.fn(async () => '{"a":1}');
    const second = jest.fn(async () => '{"b":2}');
    const releaseFirst = installProtocol(renderer, first);
    const releaseSecond = installProtocol(renderer, second);
    expect(renderer.addProtocol).toHaveBeenCalledTimes(1);
    expect(Object.keys(registered)).toEqual(['veloq']);

    const handler = registered.veloq as maplibregl.ProtocolHandler;
    await handler(request('veloq://geo/sections/all', 'json'), new AbortController());
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    releaseFirst();
    await handler(request('veloq://geo/sections/all?v=2', 'json'), new AbortController());
    expect(second).toHaveBeenCalledTimes(2);

    releaseSecond();
    await expect(
      handler(request('veloq://geo/sections/all?v=3', 'json'), new AbortController())
    ).rejects.toThrow('not connected');
  });
});
