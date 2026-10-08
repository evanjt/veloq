// Build the bundle `measure-recording-save.sh` serves to the handset: the save
// tap's two JavaScript legs, `generateFitFile` and `bufferToBase64`, over a
// three-hour ride, timed in the app's own Hermes with nothing else loaded.
//
// `node scripts/measure-recording-save-bundle.mjs OUT.js` writes the source,
// transpiled from the tree so it times the code that ships. `ROUNDS` sets how
// many timed saves follow the one warm-up. `PROBE=1` adds, per round, the
// FIT's CRC pass timed on its own as written and as an indexed loop, and the
// file's bytes written through one method call each against one indexed store.
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = process.argv[2];
if (!out) {
  console.error('usage: measure-recording-save-bundle.mjs OUT.js');
  process.exit(2);
}
const rounds = Number(process.env.ROUNDS ?? 10);
const probe = process.env.PROBE === '1';

// The modules the two legs reach, each under the specifier its importers use.
const modules = {
  fitGenerator: 'src/features/recording/lib/fitGenerator.ts',
  './savedLaps': 'src/features/recording/lib/savedLaps.ts',
  './pausedTime': 'src/features/recording/lib/pausedTime.ts',
};

function transpile(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
}

// `bufferToBase64` lives beside the file system and the engine, so it is taken
// out of its module by its text rather than importing either.
const library = fs.readFileSync(
  path.join(root, 'src/features/recording/lib/storage/recordingLibrary.ts'),
  'utf8'
);
const chunk = library.match(/const BASE64_CHUNK = \d+;/)[0];
const encoder = library.match(/export function bufferToBase64[\s\S]*?\n}\n/)[0];
const base64 = ts.transpileModule(`${chunk}\n${encoder}`, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

const defs = Object.entries(modules)
  .map(
    ([name, file]) =>
      `defs[${JSON.stringify(name)}] = function (exports, require) {\n${transpile(file)}\n};`
  )
  .join('\n');

const bundle = `
var g = typeof globalThis !== 'undefined' ? globalThis : this;
function emit(line) {
  if (typeof g.nativeLoggingHook === 'function') g.nativeLoggingHook('[save-cost] ' + line, 1);
  else if (typeof g.print === 'function') g.print('[save-cost] ' + line);
  else console.log('[save-cost] ' + line);
}
var now = g.performance && g.performance.now
  ? function () { return g.performance.now(); }
  : g.nativePerformanceNow || function () { return Date.now(); };
var defs = {};
var cache = {
  '@/shared/debug/debug': { debug: { create: function () {
    var nop = function () {};
    return { log: nop, warn: nop, error: nop, info: nop, debug: nop };
  } } },
};
function req(name) {
  if (cache[name]) return cache[name];
  if (!defs[name]) return {};
  var module = { exports: {} };
  cache[name] = module.exports;
  defs[name](module.exports, req);
  return module.exports;
}
${defs}
var encoderExports = {};
(function (exports) {\n${base64}\n})(encoderExports);

function buildStreams(samples) {
  var s = { time: [], latlng: [], altitude: [], heartrate: [], power: [], cadence: [], speed: [], distance: [] };
  for (var i = 0; i < samples; i++) {
    s.time.push(i);
    s.latlng.push([46.5 + i * 0.00001, 6.6 + i * 0.00001]);
    s.altitude.push(400 + (i % 200));
    s.heartrate.push(140 + (i % 20));
    s.power.push(220 + (i % 60));
    s.cadence.push(85 + (i % 10));
    s.speed.push(8 + (i % 5));
    s.distance.push(i * 8);
  }
  return s;
}

var fit = req('fitGenerator');
var streams = buildStreams(3 * 60 * 60);
var engineName = g.HermesInternal ? 'hermes' : 'other';
var bytecode = !!(g.HermesInternal && g.HermesInternal.getRuntimeProperties &&
  g.HermesInternal.getRuntimeProperties()['Bytecode Version']);
emit('start engine=' + engineName + ' samples=' + streams.time.length + ' rounds=${rounds}');

var CRC = new Uint16Array([0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401,
  0xa001, 0x6c00, 0x7800, 0xb401, 0x5000, 0x9c01, 0x8801, 0x4400]);
function crcForOf(data) {
  var crc = 0;
  for (const byte of data) {
    crc = (crc >> 4) ^ CRC[(crc ^ byte) & 0x0f];
    crc = (crc >> 4) ^ CRC[(crc ^ (byte >> 4)) & 0x0f];
  }
  return crc;
}
function crcIndexed(data) {
  var crc = 0;
  for (var i = 0, n = data.length; i < n; i++) {
    var byte = data[i];
    crc = (crc >> 4) ^ CRC[(crc ^ byte) & 0x0f];
    crc = (crc >> 4) ^ CRC[(crc ^ (byte >> 4)) & 0x0f];
  }
  return crc;
}
function Writer(size) { this.bytes = new Uint8Array(size); this.length = 0; this.dataSize = 0; }
Writer.prototype.push = function (v) { this.bytes[this.length] = v & 0xff; this.length += 1; };
Writer.prototype.writeUint8 = function (v) { this.push(v); this.dataSize++; };
function probeRound(buffer) {
  var data = new Uint8Array(buffer);
  var t0 = now(); var a = crcForOf(data); var t1 = now(); var b = crcIndexed(data); var t2 = now();
  var w = new Writer(data.length);
  for (var i = 0; i < data.length; i++) w.writeUint8(data[i]);
  var t3 = now();
  var out = new Uint8Array(data.length);
  for (var j = 0; j < data.length; j++) out[j] = data[j];
  var t4 = now();
  emit('  probe crc_forof_ms=' + (t1 - t0).toFixed(1) + ' crc_indexed_ms=' + (t2 - t1).toFixed(1) +
    ' same=' + (a === b) + ' bytes_by_call_ms=' + (t3 - t2).toFixed(1) +
    ' bytes_indexed_ms=' + (t4 - t3).toFixed(1));
}

async function run() {
  for (var round = 0; round <= ${rounds}; round++) {
    var t0 = now();
    var buffer = await fit.generateFitFile({
      activityType: 'Ride',
      startTime: new Date('2026-09-12T06:00:00Z'),
      streams: streams,
      laps: [],
    });
    var t1 = now();
    var text = encoderExports.bufferToBase64(buffer);
    var t2 = now();
    emit((round === 0 ? 'warmup' : 'round ' + round) +
      ' fit_kb=' + (buffer.byteLength / 1024).toFixed(0) +
      ' build_ms=' + (t1 - t0).toFixed(1) +
      ' base64_ms=' + (t2 - t1).toFixed(1) +
      ' total_ms=' + (t2 - t0).toFixed(1) +
      ' b64_kb=' + (text.length / 1024).toFixed(0));
    if (${probe ? 'true' : 'false'}) probeRound(buffer);
  }
  emit('done');
}
run().catch(function (e) { emit('error ' + String(e && e.stack || e)); });
`;
fs.writeFileSync(out, bundle);
