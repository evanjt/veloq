import {
  MAX_MESSAGE_BYTES,
  MAX_MESSAGES_PER_PEER,
  admitsAddress,
  announce,
  displaced,
  isRoomId,
  nextJoin,
  relay,
  type AddressLimiter,
  type Peer,
} from '../../../link-relay/src/room';

function peer(): Peer & { received: string[] } {
  const received: string[] = [];
  return { received, send: (message: string) => received.push(message) };
}

function limiter(success: boolean): AddressLimiter & { keys: string[] } {
  const keys: string[] = [];
  return {
    keys,
    limit: async ({ key }) => {
      keys.push(key);
      return { success };
    },
  };
}

const offer = JSON.stringify({ type: 'offer', sdp: 'v=0' });

describe('link relay room', () => {
  it('tells both peers once the second joins, so the browser knows to offer', () => {
    const phone = peer();
    announce([phone]);
    expect(phone.received).toEqual([]);

    const browser = peer();
    announce([phone, browser]);
    const present = JSON.stringify({ type: 'peer' });
    expect(phone.received).toEqual([present]);
    expect(browser.received).toEqual([present]);
  });

  it('never forwards a peer notice one side sends itself', () => {
    const phone = peer();
    const browser = peer();
    expect(relay(browser, JSON.stringify({ type: 'peer' }), [phone, browser], 0)).toBe('dropped');
    expect(phone.received).toEqual([]);
  });

  it('displaces nobody while the room has a free seat', () => {
    expect(displaced([])).toEqual([]);
    expect(displaced([{ joined: 1 }])).toEqual([]);
  });

  it('displaces the oldest peer when a third joins, whatever order the room lists them in', () => {
    const newer = { joined: 5 };
    const oldest = { joined: 2 };
    expect(displaced([newer, oldest])).toEqual([oldest]);
    expect(displaced([oldest, newer])).toEqual([oldest]);
  });

  it('numbers each arrival after the most recent peer present', () => {
    expect(nextJoin([])).toBe(1);
    expect(nextJoin([{ joined: 3 }, { joined: 1 }])).toBe(4);
  });

  it('forwards a connection setup message to the other peer only', () => {
    const phone = peer();
    const browser = peer();
    expect(relay(phone, offer, [phone, browser], 0)).toBe('forwarded');
    expect(browser.received).toEqual([offer]);
    expect(phone.received).toEqual([]);
  });

  it.each([
    ['an unknown type', JSON.stringify({ type: 'data', rows: [1, 2, 3] })],
    ['no type', JSON.stringify({ sdp: 'v=0' })],
    ['text that is not JSON', 'hello'],
    ['a JSON array', JSON.stringify(['offer'])],
    ['an oversize offer', JSON.stringify({ type: 'offer', sdp: 'x'.repeat(MAX_MESSAGE_BYTES) })],
  ])('drops %s without forwarding it', (_case, message) => {
    const phone = peer();
    const browser = peer();
    expect(relay(phone, message, [phone, browser], 0)).toBe('dropped');
    expect(browser.received).toEqual([]);
  });

  it('drops a binary frame', () => {
    const phone = peer();
    const browser = peer();
    expect(relay(phone, new ArrayBuffer(8), [phone, browser], 0)).toBe('dropped');
    expect(browser.received).toEqual([]);
  });

  it('stops forwarding once a peer has spent its message budget', () => {
    const phone = peer();
    const browser = peer();
    expect(relay(phone, offer, [phone, browser], MAX_MESSAGES_PER_PEER - 1)).toBe('forwarded');
    expect(relay(phone, offer, [phone, browser], MAX_MESSAGES_PER_PEER)).toBe('over budget');
    expect(browser.received).toHaveLength(1);
  });

  it('forwards nothing when the peer is alone', () => {
    const phone = peer();
    expect(relay(phone, offer, [phone], 0)).toBe('forwarded');
    expect(phone.received).toEqual([]);
  });

  it('accepts only opaque room ids', () => {
    expect(isRoomId('Zm9vYmFyYmF6cXV4cXV1eHh5')).toBe(true);
    expect(isRoomId('short')).toBe(false);
    expect(isRoomId('has/slash-and-more-characters-here')).toBe(false);
    expect(isRoomId('x'.repeat(129))).toBe(false);
  });

  it('refuses an address once its limiter says no', async () => {
    expect(await admitsAddress(limiter(false), '203.0.113.7')).toBe(false);
  });

  it('admits an address its limiter allows', async () => {
    expect(await admitsAddress(limiter(true), '203.0.113.7')).toBe(true);
  });

  it('counts each address under its own key', async () => {
    const counter = limiter(true);
    await admitsAddress(counter, '203.0.113.7');
    await admitsAddress(counter, '198.51.100.2');
    expect(counter.keys).toEqual(['203.0.113.7', '198.51.100.2']);
  });
});
