/**
 * The link relay: a WebSocket room per pair at `/link/<room>`.
 *
 * It forwards only what `room.ts` lets through and records nothing. The
 * worker has observability off in `wrangler.toml` and makes no logging call,
 * so no request, address or payload is kept.
 */

import { DurableObject } from 'cloudflare:workers';

import { ROOM_TTL_MS, admits, admitsAddress, announce, isRoomId, relay } from './room';

interface Env {
  ROOMS: DurableObjectNamespace<LinkRoom>;
  LINK_LIMIT: RateLimit;
}

interface Attachment {
  sent: number;
}

const PATH = /^\/link\/([^/]+)$/;

export class LinkRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected a WebSocket', { status: 426 });
    }
    if (!admits(this.ctx.getWebSockets().length)) {
      return new Response('Room full', { status: 409 });
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ sent: 0 } satisfies Attachment);
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + ROOM_TTL_MS);
    }
    announce(this.ctx.getWebSockets());
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    const attachment = socket.deserializeAttachment() as Attachment;
    const outcome = relay(socket, message, this.ctx.getWebSockets(), attachment.sent);
    if (outcome === 'forwarded') {
      socket.serializeAttachment({ sent: attachment.sent + 1 } satisfies Attachment);
    } else if (outcome === 'over budget') {
      socket.close(1008, 'Message budget spent');
    }
  }

  webSocketClose(socket: WebSocket, code: number): void {
    for (const peer of this.ctx.getWebSockets()) {
      if (peer !== socket) peer.send(JSON.stringify({ type: 'bye' }));
    }
    socket.close(code === 1005 ? 1000 : code, 'Closed');
  }

  async alarm(): Promise<void> {
    for (const peer of this.ctx.getWebSockets()) peer.close(1001, 'Room expired');
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
