// Reads the logcat files `measure-3d-open-stages.sh` writes and prints one
// row per open: every stage as milliseconds after the open's deep link was
// started, then the tile and resource summaries the page posted.
//
//   node scripts/measure/map3d-open-stages.mjs OUT/*.log
import fs from 'node:fs';

const STAGES = [
  'amvRender',
  'posterLoad',
  'pageDue',
  'memo',
  'native.newView',
  'native.setNewSource',
  'native.adoptAsk',
  'native.adoptResult',
  'js.pageAdopted',
  'js.adoptInject',
  'page.docScript',
  'page.build',
  'page.mapNew',
  'page.styledata',
  'page.load',
  'page.terrainSet',
  'page.demLoaded',
  'page.routeLoaded',
  'page.ready',
  'js.mapReady',
  'js.is3DReady',
  'js.is3DReadyFrame',
  'page.idle',
  'page.openingCamera',
  'page.failed',
  'page.readyTimeout',
];

function parse(file) {
  const opens = [];
  let open = null;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const epoch = line.match(/^\s*(\d+)\.(\d{3})/);
    if (!epoch) continue;
    const lineMs = Number(epoch[1]) * 1000 + Number(epoch[2]);
    // Logcat redacts the link's data, so the id comes from the render stamp.
    if (/START u0 \{act=android\.intent\.action\.VIEW/.test(line)) {
      open = { file, id: '?', t0: lineMs, stages: {}, extra: {} };
      opens.push(open);
      continue;
    }
    if (!open) continue;
    const id = line.match(/js\.amvRender .*id=([\w-]+)/);
    if (id) open.id = id[1];
    const native = line.match(/stamp3d\s*: (native\.\S+)(.*?) t=(\d+)/);
    if (native) {
      const name = native[1].replace(/=.*$/, '');
      open.stages[name] ??= Number(native[3]);
      open.extra[name] = (native[1] + native[2]).trim();
      continue;
    }
    const js = line.match(/\[stamp3d\] (\S+) t=(\d+)(.*)$/);
    if (!js) continue;
    const name = js[1].replace(/^js\.(amvRender|posterLoad|pageDue|memo)$/, '$1');
    const rest = js[3]
      .replace(/rx=\d+/, '')
      .replace(/['"]+$/, '')
      .trim();
    if (name.startsWith('page.resources-') || name.startsWith('page.tiles-')) {
      open.extra[name] = rest;
      continue;
    }
    open.stages[name] ??= Number(js[2]);
    if (rest) open.extra[name] = rest;
  }
  return opens;
}

const opens = process.argv.slice(2).flatMap(parse);
for (const o of opens) {
  const held = o.extra['native.newView'] ?? '';
  console.log(`\n${o.file} ${o.id} ${held}`);
  const row = STAGES.filter((s) => o.stages[s] !== undefined)
    .map((s) => `${s}=${o.stages[s] - o.t0}`)
    .join('  ');
  console.log(row);
  for (const k of Object.keys(o.extra)) {
    if (
      k.startsWith('page.tiles-') ||
      k.startsWith('page.resources-') ||
      k === 'page.build' ||
      k === 'page.openingCamera'
    ) {
      const text = o.extra[k]
        .replace(/first=(\d+)/g, (_, t) => `first=${t - o.t0}`)
        .replace(/last=(\d+)/g, (_, t) => `last=${t - o.t0}`);
      console.log(`  ${k}: ${text}`);
    }
  }
}
