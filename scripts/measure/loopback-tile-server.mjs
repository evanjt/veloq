// A stand-in for an on-device loopback tile listener, reached from the phone
// through `adb reverse`. It answers /<token>/<anything> after a fixed delay
// with a small body, refuses any other path with 404, sends CORS for the map
// page's origin, answers preflights, and logs every request with its arrival
// and finish times and any local-network headers the WebView sent.
//
// node scripts/measure/loopback-tile-server.mjs <token> <delay ms> <port>...
import http from 'node:http';

const [token, delayArg, ...ports] = process.argv.slice(2);
const delay = Number(delayArg ?? 300);
const t0 = Date.now();
const body = Buffer.alloc(20000, 7);

for (const port of ports.map(Number)) {
  http
    .createServer((req, res) => {
      const at = Date.now() - t0;
      const lna = Object.entries(req.headers)
        .filter(([k]) => /private-network|local-network|origin|sec-fetch/.test(k))
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      const cors = {
        'Access-Control-Allow-Origin': req.headers.origin ?? '*',
        'Access-Control-Allow-Private-Network': 'true',
        'Access-Control-Allow-Local-Network': 'true',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': '*',
      };
      if (req.method === 'OPTIONS') {
        console.error(`${at} ${port} OPTIONS ${req.url} ${lna}`);
        res.writeHead(204, cors).end();
        return;
      }
      if (!req.url.startsWith(`/${token}/`)) {
        console.error(`${at} ${port} 404 ${req.url} ${lna}`);
        res.writeHead(404, cors).end();
        return;
      }
      setTimeout(() => {
        console.error(`${at} ${Date.now() - t0} ${port} 200 ${req.url} ${lna}`);
        res.writeHead(200, { ...cors, 'Content-Type': 'application/x-protobuf' }).end(body);
      }, delay);
    })
    .listen(port, '127.0.0.1');
}
console.error(`listening on ${ports.join(',')}, delay ${delay} ms`);
