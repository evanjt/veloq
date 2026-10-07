#!/usr/bin/env node
// Take a Hermes heap snapshot from a debuggable build without Metro.
//
// A debug build reaches its packager's inspector at `/inspector/device` and
// keeps retrying while nothing answers. Started after the app has loaded its
// embedded bundle, this stands in for that endpoint, so the snapshot is of
// the bundle the build carries rather than a development bundle a packager
// would have served at launch.
//
//   node scripts/session-memory/heap-snapshot.mjs <port> <out.heapsnapshot>

import { createServer } from 'node:http';
import { createWriteStream } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');

const [port, out] = process.argv.slice(2);
const SESSION = 'snapshot';
const deadline = setTimeout(
  () => {
    console.error('heap-snapshot: no snapshot within ten minutes');
    process.exit(1);
  },
  10 * 60 * 1000
);

const server = createServer((req, res) => {
  res.writeHead(404);
  res.end();
});
const wss = new WebSocket.Server({ server, path: '/inspector/device' });

wss.on('connection', (socket, req) => {
  console.error(`heap-snapshot: device connected, ${req.url}`);
  const send = (message) => socket.send(JSON.stringify(message));
  let pageId = null;
  let next = 1;
  const call = (method, params = {}) => {
    const id = next++;
    send({
      event: 'wrappedEvent',
      payload: { pageId, sessionId: SESSION, wrappedEvent: JSON.stringify({ id, method, params }) },
    });
    return id;
  };
  let snapshotId = null;
  let file = null;
  let bytes = 0;

  const poll = setInterval(() => send({ event: 'getPages' }), 1000);
  send({ event: 'getPages' });

  socket.on('message', (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.event === 'getPages' && pageId === null && message.payload.length > 0) {
      const pages = message.payload;
      console.error(
        `heap-snapshot: pages ${JSON.stringify(pages.map((p) => [p.id, p.title, p.vm]))}`
      );
      pageId = pages[pages.length - 1].id;
      clearInterval(poll);
      send({ event: 'connect', payload: { pageId, sessionId: SESSION } });
      call('HeapProfiler.enable');
      call('HeapProfiler.collectGarbage');
      file = createWriteStream(out);
      snapshotId = call('HeapProfiler.takeHeapSnapshot', { reportProgress: false });
      return;
    }
    if (message.event !== 'wrappedEvent') return;
    const inner = JSON.parse(message.payload.wrappedEvent);
    if (inner.method === 'HeapProfiler.addHeapSnapshotChunk') {
      file.write(inner.params.chunk);
      bytes += inner.params.chunk.length;
      return;
    }
    if (inner.id === snapshotId) {
      if (inner.error) {
        console.error(`heap-snapshot: ${JSON.stringify(inner.error)}`);
        process.exit(1);
      }
      file.end(() => {
        console.error(`heap-snapshot: wrote ${bytes} bytes to ${out}`);
        clearTimeout(deadline);
        send({ event: 'disconnect', payload: { pageId, sessionId: SESSION } });
        process.exit(0);
      });
    }
  });
});

server.listen(Number(port), () => console.error(`heap-snapshot: listening on ${port}`));
