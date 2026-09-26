/**
 * What the JS half of the map signature read costs: `decodeCoords` over every
 * blob, plus the `{lat,lng}` map `useRouteSignatures` does with the result.
 *
 * The third of `I193`'s three passes. The other two are Rust and are timed on
 * the handset by the `map_signature_passes` example, which also dumps the
 * encoded blobs this reads, so both halves are timed over the same bytes:
 *
 *     VELOQ_DB=/data/local/tmp/routes.db VELOQ_DUMP=/tmp/sigs ./map_signature_passes
 *     npx tsx scripts/measure-signature-decode.ts /tmp/sigs 15
 *
 * **This runs on V8, and the app runs on Hermes.** The figure is a floor for
 * the handset rather than the handset's own, because nothing on the machine can
 * run Hermes: the only VM is inside the APK and the installed build opens no
 * inspector socket.
 */
import { readdirSync, readFileSync } from 'node:fs';

import { decodeCoords } from '../modules/veloqrs/src/coords';

const dir = process.argv[2];
const runs = Number(process.argv[3] ?? 5);
if (!dir) {
  console.error('usage: measure-signature-decode.ts <dump dir> [runs]');
  process.exit(1);
}

const buffers = readdirSync(dir)
  .filter((f) => f.endsWith('.bin'))
  .map((f) => {
    const b = readFileSync(`${dir}/${f}`);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  });

const times: number[] = [];
let points = 0;
for (let run = 0; run < runs; run++) {
  const t0 = performance.now();
  let n = 0;
  for (const buf of buffers) {
    const decoded = decodeCoords(buf);
    if (decoded.length < 2) continue;
    const mapped = decoded.map((p) => ({ lat: p.latitude, lng: p.longitude }));
    n += mapped.length;
  }
  times.push(performance.now() - t0);
  points = n;
}

times.sort((a, b) => a - b);
const median = times[times.length >> 1];
console.log(
  `${buffers.length} blobs, ${points} points, ${runs} runs: median ${median.toFixed(2)} ms, ` +
    `min ${times[0].toFixed(2)} ms, max ${times[times.length - 1].toFixed(2)} ms`,
);
