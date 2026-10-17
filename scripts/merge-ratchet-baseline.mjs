#!/usr/bin/env node
// Git merge driver for a ratchet baseline: `%O %A %B`, the result written to %A.
//
// A baseline holds a count per key, nested under a class or not, and a count
// only ever falls: a sweep lowers it, and a file above it fails its guard. So
// where both sides changed the file, each key takes the lower count. A key one
// side dropped from the base was taken to zero there and stays dropped; a key
// only one side has, and the base never had, is new on that side and is kept.
// Any value that is not a count or an object of counts has no lower one, so
// the file is left as git's conflict for a hand.

import { readFileSync, writeFileSync } from 'node:fs';

const [basePath, oursPath, theirsPath] = process.argv.slice(2);

const isRecord = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

function refuse(why) {
  console.error(`merge-ratchet-baseline: ${why}, so it is left as a conflict`);
  process.exit(1);
}

function read(path) {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8'));
    if (!isRecord(value)) refuse(`${path} is not an object`);
    return value;
  } catch {
    refuse(`${path} is not JSON`);
  }
}

/** One side's value at a key: absent where the base had it means taken to zero. */
const side = (record, base, key) =>
  key in record ? record[key] : base !== undefined && key in base ? 0 : undefined;

function merge(base, ours, theirs, at) {
  const out = {};
  for (const key of [...new Set([...Object.keys(ours), ...Object.keys(theirs)])].sort((x, y) =>
    x.localeCompare(y)
  )) {
    const a = side(ours, base, key);
    const b = side(theirs, base, key);
    const where = at ? `${at}.${key}` : key;
    const values = [a, b].filter((v) => v !== undefined);
    if (values.every(isRecord) || values.some(isRecord)) {
      if (!values.every((v) => isRecord(v) || v === 0)) refuse(`${where} mixes a count and a map`);
      if (values.some((v) => v === 0)) continue;
      const nestedBase = base !== undefined && isRecord(base[key]) ? base[key] : undefined;
      out[key] = merge(nestedBase, a ?? {}, b ?? {}, where);
      continue;
    }
    if (!values.every((v) => typeof v === 'number')) refuse(`${where} is not a count`);
    const lowest = Math.min(...values);
    if (lowest > 0) out[key] = lowest;
  }
  return out;
}

const merged = merge(read(basePath), read(oursPath), read(theirsPath), '');
writeFileSync(oursPath, JSON.stringify(merged, null, 2) + '\n');
