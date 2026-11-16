/**
 * Scenario: a view asked the phone for a read and went away before the phone
 * answered.
 *
 * Expected behaviour: aborting the ask's signal rejects its promise as
 * cancelled, tells the phone to cancel that request id, and ignores a reply
 * that comes later; an ask whose signal is already aborted sends nothing.
 */

import { createClient, type Channel } from '../../../web/connect/client';
import { isCancelled } from '../../../web/connect/link';

function channelOf() {
  const sent: { id?: number; method: string; params: { id?: number } }[] = [];
  const channel: Channel = {
    readyState: 'open',
    binaryType: 'blob',
    send: (text) => sent.push(JSON.parse(text)),
    onmessage: null,
  };
  return { channel, sent };
}

describe('withdrawing an ask', () => {
  it('rejects as cancelled and sends a cancel for the ask id', async () => {
    const { channel, sent } = channelOf();
    const client = createClient(channel);
    const controller = new AbortController();
    const asked = client.ask('feed.summary', {} as never, undefined, controller.signal);
    const outcome = asked.catch((error) => error);
    controller.abort();
    expect(isCancelled(await outcome)).toBe(true);
    expect(sent[1]).toEqual({ method: 'cancel', params: { id: sent[0].id } });
  });

  it('sends no cancel when the ask was already answered', async () => {
    const { channel, sent } = channelOf();
    const client = createClient(channel);
    const controller = new AbortController();
    const asked = client.ask('feed.summary', {} as never, undefined, controller.signal);
    const id = sent[0].id as number;
    const body = new TextEncoder().encode(JSON.stringify({ id, result: 'week' }));
    const frame = new Uint8Array(10 + body.length);
    const view = new DataView(frame.buffer);
    view.setUint8(0, 1);
    view.setUint8(1, 2);
    view.setUint32(2, id);
    frame.set(body, 10);
    await client.settle(frame);
    await expect(asked).resolves.toBe('week');
    controller.abort();
    expect(sent).toHaveLength(1);
  });

  it('sends nothing for a signal that is already aborted', async () => {
    const { channel, sent } = channelOf();
    const client = createClient(channel);
    const controller = new AbortController();
    controller.abort();
    await expect(
      client.ask('feed.summary', {} as never, undefined, controller.signal)
    ).rejects.toMatchObject({ name: 'CancelledError' });
    expect(sent).toHaveLength(0);
  });
});
