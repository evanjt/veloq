#!/usr/bin/env node
// The steps of `scripts/measure-ios-memory.sh` that read its captures.
//
//   node scripts/ios-memory.mjs select <ps file> <app pid>
//       the pids to hand `footprint`, one line
//   node scripts/ios-memory.mjs record <dir> <udid> <bundle id> <commit> <label>...
//       the record, from <dir>/<label>.ps, .footprint and .pid for each label
//   node scripts/ios-memory.mjs compare <record> <baseline> <max regression>
//       one line per point, and exit 1 when a total grew past the regression

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const memory = createRequire(import.meta.url)('./lib/ios-memory.js');

const MIB = 1024 * 1024;
const [command, ...args] = process.argv.slice(2);
const read = (file) => readFileSync(file, 'utf8');

if (command === 'select' && args.length === 2) {
  const [ps, pid] = args;
  console.log(
    memory
      .selectProcesses(read(ps), Number(pid))
      .map((p) => p.pid)
      .join(' ')
  );
} else if (command === 'record' && args.length >= 5) {
  const [dir, udid, bundleId, commit, ...labels] = args;
  const points = labels.map((label) =>
    memory.readPoint(
      label,
      read(join(dir, `${label}.ps`)),
      read(join(dir, `${label}.footprint`)),
      Number(read(join(dir, `${label}.pid`)).trim())
    )
  );
  const peakTotalBytes = Math.max(...points.map((point) => point.totalBytes));
  const record = { udid, bundleId, commit, at: new Date().toISOString(), points, peakTotalBytes };
  console.log(JSON.stringify(record, null, 2));
} else if (command === 'compare' && args.length === 3) {
  const [recordFile, baselineFile, max] = args;
  const verdict = memory.compareRecords(
    JSON.parse(read(recordFile)),
    JSON.parse(read(baselineFile)),
    Number(max)
  );
  for (const row of verdict.rows) {
    const mib = (bytes) => Math.round(bytes / MIB);
    const change = ((row.ratio - 1) * 100).toFixed(1);
    const mark = row.over ? 'OVER' : 'ok';
    console.log(
      `${mark}\t${row.label}\t${mib(row.totalBytes)} MiB against ${mib(row.baselineBytes)} MiB (${change} %)`
    );
  }
  if (verdict.rows.length === 0) console.error('ios-memory: the baseline shares no point');
  if (!verdict.ok) process.exit(1);
} else {
  console.error('usage: ios-memory.mjs select <ps> <pid>');
  console.error('       ios-memory.mjs record <dir> <udid> <bundle id> <commit> <label>...');
  console.error('       ios-memory.mjs compare <record> <baseline> <max regression>');
  process.exit(2);
}
