// The protocol client: asks over a data channel and matches each reply to its
// ask by id. It holds no DOM and no globals, only the channel it is given, so
// a test drives it with a stand-in.

import {
  Replies,
  UnreadableReply,
  cancelMessage,
  farewellOf,
  isChanged,
  type Farewell,
} from './link';
import type { Methods } from './schema';

/** What the client needs of a data channel. */
export interface Channel {
  readonly readyState: string;
  binaryType: string;
  send: (text: string) => void;
  onmessage: ((event: MessageEvent) => void) | null;
}

export interface Client {
  /**
   * Ask one method of the link protocol, typed by the schema the engine
   * generates. With a `slot`, an earlier ask still outstanding in that slot is
   * withdrawn: the phone is told to cancel it and its promise rejects as
   * superseded, so a fast scroll leaves one read in flight per pane.
   */
  ask: <M extends keyof Methods>(
    method: M,
    params: Methods[M]['params'],
    slot?: string
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
 * `onChanged` is called when the phone says its library changed, an event
 * under request id 0, which no ask uses. `onFarewell` is called with the
 * reason the phone gives for leaving, an event under the same id, just
 * before it hangs up.
 */
export function createClient(
  channel: Channel,
  onUnreadable: () => void = () => {},
  onChanged: () => void = () => {},
  onFarewell: (reason: Farewell) => void = () => {}
): Client {
  const replies = new Replies();
  let nextId = 1;
  let closed = false;

  function send(method: string, params: object, slot?: string) {
    if (closed || channel.readyState !== 'open') {
      return Promise.reject(new Error('not connected'));
    }
    const id = nextId++;
    const reply = replies.wait(id);
    const earlier = slot === undefined ? undefined : replies.supersede(slot, id);
    if (earlier !== undefined) channel.send(cancelMessage(earlier));
    // Whichever ask the unreadable reply came back for, the page shows the update notice.
    void reply.catch((error: unknown) => {
      if (error instanceof UnreadableReply && !closed) onUnreadable();
    });
    channel.send(JSON.stringify({ id, method, params }));
    return reply;
  }

  async function settle(data: unknown) {
    const reply = await replies.take(data, (id) => id === 0 || replies.has(id));
    if (!reply) return;
    const farewell = farewellOf(reply);
    if (farewell) {
      if (!closed) onFarewell(farewell);
    } else if (isChanged(reply)) {
      if (!closed) onChanged();
    } else replies.settle(reply);
  }

  // Replies come as binary frames, and the default type would hand them over as a Blob.
  channel.binaryType = 'arraybuffer';
  channel.onmessage = ({ data }) => void settle(data);

  return {
    ask: (method, params, slot) => send(method, params, slot) as Promise<never>,
    askPairing: (method, params = {}) => send(method, params),
    settle,
    hangUp() {
      closed = true;
      replies.rejectAll('hung up');
    },
  };
}
