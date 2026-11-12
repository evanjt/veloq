/**
 * Scenario: the connect page asks the phone over a data channel and matches
 * each reply to its ask by id.
 *
 * Expected behaviour: a reply for an id nothing asked is ignored. A message
 * that is not a frame of this protocol fails every ask in flight and reports
 * the phone as speaking another protocol, once per ask and never after a
 * hang-up. A reply with an error rejects its ask. A
 * hang-up rejects every pending ask with one error and a later reply for them
 * does nothing. An ask on a channel that is not open rejects without sending.
 * A reply cut into frames, gzipped or not, settles its ask once the last frame
 * is in.
 */

import zlib from 'zlib';

import { createClient, type Channel } from '../../../web/connect/client';
import { UnreadableReply } from '../../../web/connect/link';

function channelOf(readyState: Channel['readyState'] = 'open') {
  const sent: { id: number; method: string; params: object }[] = [];
  const channel: Channel = {
    readyState,
    binaryType: 'blob',
    send: (text) => sent.push(JSON.parse(text)),
    onmessage: null,
  };
  return { channel, sent };
}

const GZIP = 1;
const LAST = 2;

/** A reply frame as the engine writes it: version, flags, request id, sequence, body. */
function frame(id: number, seq: number, flags: number, body: Uint8Array) {
  const out = new Uint8Array(10 + body.length);
  const view = new DataView(out.buffer);
  view.setUint8(0, 1);
  view.setUint8(1, flags);
  view.setUint32(2, id);
  view.setUint32(6, seq);
  out.set(body, 10);
  return out;
}

const text = (body: object) => new TextEncoder().encode(JSON.stringify(body));
const reply = (body: { id: number; result?: unknown; error?: string }) =>
  frame(body.id, 0, LAST, text(body));

describe('connect page protocol client', () => {
  it('sends an ask with a fresh id and resolves it with the reply result', async () => {
    const { channel, sent } = channelOf();
    const client = createClient(channel);
    const first = client.ask('feed.page', {
      offset: 0,
      limit: 1,
      needle: '',
      sportFamilies: [],
      oldestTs: null,
      newestTs: null,
    });
    const second = client.askPairing('pair.status');
    expect(sent.map((message) => message.id)).toEqual([1, 2]);
    expect(sent[0]).toMatchObject({
      method: 'feed.page',
      params: {
        offset: 0,
        limit: 1,
        needle: '',
        sportFamilies: [],
        oldestTs: null,
        newestTs: null,
      },
    });
    expect(sent[1]).toMatchObject({ method: 'pair.status', params: {} });

    await client.settle(reply({ id: 2, result: 'waiting' }));
    await client.settle(reply({ id: 1, result: { cards: [] } }));
    await expect(second).resolves.toBe('waiting');
    await expect(first).resolves.toEqual({ cards: [] });
  });

  it('ignores a reply for an id nothing asked and a message that is neither text nor binary', async () => {
    const { channel } = channelOf();
    const unreadable = jest.fn();
    const client = createClient(channel, unreadable);
    const pending = client.askPairing('pair.status');
    await client.settle(reply({ id: 99, result: 'stray' }));
    await client.settle(42);
    await client.settle(reply({ id: 1, result: 'confirmed' }));
    await expect(pending).resolves.toBe('confirmed');
    expect(unreadable).not.toHaveBeenCalled();
  });

  it.each([
    ['a reply in the previous text format', JSON.stringify({ id: 1, result: { protocol: 2 } })],
    ['a message too short to be a frame', new Uint8Array(4)],
    [
      'a frame of another version',
      (() => {
        const other = reply({ id: 1, result: 'x' });
        other[0] = 2;
        return other;
      })(),
    ],
  ])('fails every ask in flight and reports another protocol on %s', async (_, message) => {
    const { channel } = channelOf();
    const unreadable = jest.fn();
    const client = createClient(channel, unreadable);
    const asks = Promise.allSettled([
      client.askPairing('pair.status'),
      client.ask('activity.summary', { id: 'a1' }),
    ]);
    await client.settle(message);
    const settled = await asks;
    for (const outcome of settled) {
      expect(outcome.status).toBe('rejected');
      expect((outcome as PromiseRejectedResult).reason).toBeInstanceOf(UnreadableReply);
    }
    expect(unreadable).toHaveBeenCalled();
  });

  it('does not report another protocol after a hang-up', async () => {
    const { channel } = channelOf();
    const unreadable = jest.fn();
    const client = createClient(channel, unreadable);
    const pending = client.askPairing('pair.status');
    client.hangUp();
    await client.settle('{}');
    await expect(pending).rejects.toThrow('hung up');
    expect(unreadable).not.toHaveBeenCalled();
  });

  it('rejects an ask whose reply carries an error', async () => {
    const { channel } = channelOf();
    const client = createClient(channel);
    const pending = client.ask('activity.summary', { id: 'a1' });
    await client.settle(reply({ id: 1, error: 'no such activity' }));
    await expect(pending).rejects.toThrow('no such activity');
  });

  it('settles an ask once only', async () => {
    const { channel } = channelOf();
    const client = createClient(channel);
    const pending = client.askPairing('pair.status');
    await client.settle(reply({ id: 1, result: 'first' }));
    await client.settle(reply({ id: 1, result: 'second' }));
    await expect(pending).resolves.toBe('first');
  });

  it('rejects every pending ask with one error on hang-up, and a later reply does nothing', async () => {
    const { channel } = channelOf();
    const client = createClient(channel);
    const asks = [
      client.ask('feed.page', {
        offset: 0,
        limit: 1,
        needle: '',
        sportFamilies: [],
        oldestTs: null,
        newestTs: null,
      }),
      client.askPairing('pair.status'),
    ];
    const outcomes = Promise.allSettled(asks);
    client.hangUp();
    await client.settle(reply({ id: 1, result: 'late' }));
    const settled = await outcomes;
    expect(settled.map((outcome) => outcome.status)).toEqual(['rejected', 'rejected']);
    const reasons = settled.map((outcome) => (outcome as PromiseRejectedResult).reason);
    expect(reasons[0]).toBe(reasons[1]);
    expect((reasons[0] as Error).message).toBe('hung up');
  });

  it('rejects an ask after hang-up without sending', async () => {
    const { channel, sent } = channelOf();
    const client = createClient(channel);
    client.hangUp();
    await expect(
      client.ask('feed.page', {
        offset: 0,
        limit: 1,
        needle: '',
        sportFamilies: [],
        oldestTs: null,
        newestTs: null,
      })
    ).rejects.toThrow('not connected');
    expect(sent).toEqual([]);
  });

  it.each(['connecting', 'closing', 'closed'] as const)(
    'rejects an ask on a channel that is %s without sending',
    async (readyState) => {
      const { channel, sent } = channelOf(readyState);
      const client = createClient(channel);
      await expect(
        client.ask('feed.page', {
          offset: 0,
          limit: 1,
          needle: '',
          sportFamilies: [],
          oldestTs: null,
          newestTs: null,
        })
      ).rejects.toThrow('not connected');
      expect(sent).toEqual([]);
    }
  );

  it('takes its replies as array buffers from the channel it was given', async () => {
    const { channel } = channelOf();
    const client = createClient(channel);
    expect(channel.binaryType).toBe('arraybuffer');
    const pending = client.askPairing('pair.status');
    const data = reply({ id: 1, result: 'declined' }).buffer;
    channel.onmessage?.({ data } as MessageEvent);
    await expect(pending).resolves.toBe('declined');
  });

  it('joins a reply cut into frames', async () => {
    const { channel } = channelOf();
    const client = createClient(channel);
    const pending = client.ask('feed.page', {
      offset: 0,
      limit: 1,
      needle: '',
      sportFamilies: [],
      oldestTs: null,
      newestTs: null,
    });
    const whole = text({ id: 1, result: { cards: [{ id: 'a1' }] } });
    const half = Math.floor(whole.length / 2);
    await client.settle(frame(1, 0, 0, whole.slice(0, half)));
    await client.settle(frame(1, 1, LAST, whole.slice(half)));
    await expect(pending).resolves.toEqual({ cards: [{ id: 'a1' }] });
  });

  it('inflates a gzipped reply cut into frames', async () => {
    const { channel } = channelOf();
    const client = createClient(channel);
    const pending = client.ask('feed.page', {
      offset: 0,
      limit: 1,
      needle: '',
      sportFamilies: [],
      oldestTs: null,
      newestTs: null,
    });
    const cards = Array.from({ length: 500 }, (_, k) => ({ id: `a${k}` }));
    const packed = new Uint8Array(zlib.gzipSync(text({ id: 1, result: { cards } })));
    const half = packed.length >> 1;
    await client.settle(frame(1, 0, GZIP, packed.slice(0, half)));
    await client.settle(frame(1, 1, GZIP | LAST, packed.slice(half)));
    await expect(pending).resolves.toEqual({ cards });
  });
});
