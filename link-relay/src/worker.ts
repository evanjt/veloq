/**
 * The link relay: a WebSocket room per pair at `/link/<room>`.
 *
 * It forwards only what `room.ts` lets through and records nothing. The
 * worker has observability off in `wrangler.toml` and makes no logging call,
 * so no request, address or payload is kept.
 */

import { DurableObject } from 'cloudflare:workers';

import {
  ROOM_TTL_MS,
  admitsAddress,
  announce,
  displaced,
  isRoomId,
  nextJoin,
  relay,
  type Seated,
} from './room';

interface Env {
  ROOMS: DurableObjectNamespace<LinkRoom>;
  LINK_LIMIT: RateLimit;
}

interface Attachment {
  sent: number;
  joined: number;
  /** Set once the room has displaced this socket, so its own close says nothing more. */
  displaced?: boolean;
}

interface Seat extends Seated {
  socket: WebSocket;
  attachment: Attachment;
}

const PATH = /^\/link\/([^/]+)$/;

const BYE = JSON.stringify({ type: 'bye' });

export class LinkRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket', { status: 426 });
    }
    const present = this.seats();
    const leaving = displaced(present);
    for (const seat of leaving) {
      seat.socket.serializeAttachment({ ...seat.attachment, displaced: true } satisfies Attachment);
      try {
        seat.socket.close(1000, 'Replaced');
      } catch {
        // The alarm may have closed it already; its seat is leaving either way.
      }
    }
    if (leaving.length > 0) {
      for (const seat of present) {
        if (!leaving.includes(seat)) seat.socket.send(BYE);
      }
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ sent: 0, joined: nextJoin(present) } satisfies Attachment);
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
    }
    announce(this.live());
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    const attachment = socket.deserializeAttachment() as Attachment;
    const outcome = relay(socket, message, this.live(), attachment.sent);
    if (outcome === 'forwarded') {
      socket.serializeAttachment({ ...attachment, sent: attachment.sent + 1 } satisfies Attachment);
    } else if (outcome === 'over budget') {
      socket.close(1008, 'Message budget spent');
    }
  }

  webSocketClose(socket: WebSocket, code: number): void {
    if ((socket.deserializeAttachment() as Attachment).displaced) return;
    for (const peer of this.live()) {
      if (peer !== socket) peer.send(BYE);
    }
    socket.close(code === 1005 ? 1000 : code, 'Closed');
  }

  async alarm(): Promise<void> {
    for (const peer of this.ctx.getWebSockets()) peer.close(1001, 'Room expired');
  }

  /** The sockets that hold a seat: listed by the runtime and not yet displaced. */
  private seats(): Seat[] {
    const seats: Seat[] = [];
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment() as Attachment;
      if (!attachment.displaced) seats.push({ socket, attachment, joined: attachment.joined });
    }
    return seats;
  }

  private live(): WebSocket[] {
    return this.seats().map((seat) => seat.socket);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const match = PATH.exec(new URL(request.url).pathname);
    if (!match || !isRoomId(match[1])) return new Response('Not found', { status: 404 });
    // Cloudflare sets this header on every request; a client cannot choose it.
    const address = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (!(await admitsAddress(env.LINK_LIMIT, address))) {
      return new Response('Too many requests', { status: 429 });
    }
    return env.ROOMS.get(env.ROOMS.idFromName(match[1])).fetch(request);
  },
} satisfies ExportedHandler<Env>;
