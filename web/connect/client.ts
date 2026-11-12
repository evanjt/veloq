// The protocol client: asks over a data channel and matches each reply to its
// ask by id. It holds no DOM and no globals, only the channel it is given, so
// a test drives it with a stand-in.

import { Replies, UnreadableReply } from './link';
import type { Methods } from './schema';

/** What the client needs of a data channel. */
export interface Channel {
  readonly readyState: string;
  binaryType: string;
  send: (text: string) => void;
  onmessage: ((event: MessageEvent) => void) | null;
}

export interface Client {
  /** Ask one method of the link protocol, typed by the schema the engine generates. */
  ask: <M extends keyof Methods>(
    method: M,
    params: Methods[M]['params']
  ) => Promise<Methods[M]['result']>;
  /** Ask a pairing method, which the phone answers before a browser is linked. */
  askPairing: (method: string, params?: object) => Promise<unknown>;
  /** Take one reply frame off the channel. */
  settle: (data: unknown) => Promise<void>;
  /** Reject every pending ask with one error and ignore their replies from now on. */
  hangUp: () => void;
}

/**
 * `onUnreadable` is called when a reply is not in this page's format, which
 * means the phone speaks another protocol. It is not called after a hang-up.
 */
export function createClient(channel: Channel, onUnreadable: () => void = () => {}): Client {
  const replies = new Replies();
  let nextId = 1;
  let closed = false;

  function send(method: string, params: object) {
    if (closed || channel.readyState !== 'open') {
      return Promise.reject(new Error('not connected'));
    }
    const id = nextId++;
    const reply = replies.wait(id);
    // Whichever ask the unreadable reply came back for, the page shows the update notice.
    void reply.catch((error: unknown) => {
      if (error instanceof UnreadableReply && !closed) onUnreadable();
    });
    channel.send(JSON.stringify({ id, method, params }));
    return reply;
  }

  async function settle(data: unknown) {
    const reply = await replies.take(data, (id) => replies.has(id));
    if (reply) replies.settle(reply);
  }

  // Replies come as binary frames, and the default type would hand them over as a Blob.
  channel.binaryType = 'arraybuffer';
  channel.onmessage = ({ data }) => void settle(data);

  return {
    ask: (method, params) => send(method, params) as Promise<never>,
    askPairing: (method, params = {}) => send(method, params),
    settle,
    hangUp() {
      closed = true;
      replies.rejectAll('hung up');
    },
  };
}
