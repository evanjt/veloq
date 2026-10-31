#!/usr/bin/env node
// Print the flow files one shard of a tagged suite runs.
//
// Usage: shard-flows.mjs <index>/<count> <include,tags> <exclude,tags> [dir]
//
// A flow is selected when it carries any included tag and none of the excluded
// ones, the rule `maestro test --include-tags --exclude-tags` applies. The
// selected files are sorted by name and dealt round-robin, so the split is a
// function of the file names alone and every selected flow lands in exactly
// one shard of any count.

import { readdirSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The tags in a flow's header, the block before the first `---`. */
function tagsOf(source) {
  const header = source.split(/^---\s*$/m)[0];
  const block = header.match(/^tags:\s*\n((?:[ \t]*-[^\n]*\n?)+)/m);
  if (!block) return [];
  return [...block[1].matchAll(/^\s*-\s*([\w-]+)\s*(?:#.*)?$/gm)].map((m) => m[1]);
}

export function shardFlows({ dir, include, exclude, index, count }) {
  if (!Number.isInteger(index) || !Number.isInteger(count) || count < 1 || index < 1 || index > count) {
    throw new Error(`shard ${index}/${count} is outside 1..count`);
  }
  const selected = readdirSync(dir)
    .filter((name) => name.endsWith('.yaml') && name !== 'config.yaml')
    .sort()
    .filter((name) => {
      const tags = tagsOf(readFileSync(join(dir, name), 'utf8'));
      return tags.some((t) => include.includes(t)) && !tags.some((t) => exclude.includes(t));
    });
  return selected.filter((_, i) => i % count === index - 1).map((name) => join(dir, name));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [spec, includeArg = '', excludeArg = '', dir = '.maestro'] = process.argv.slice(2);
  const [index, count] = (spec ?? '').split('/').map(Number);
  const list = (value) => value.split(',').filter(Boolean);
  try {
    for (const file of shardFlows({ dir, include: list(includeArg), exclude: list(excludeArg), index, count })) {
      console.log(file);
    }
  } catch (error) {
    console.error(`${basename(process.argv[1])}: ${error.message}`);
    process.exit(2);
  }
}
