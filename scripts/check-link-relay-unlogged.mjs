#!/usr/bin/env node
// The link relay keeps no records of who connected and when.
//
// It sees each peer's address and the connection offers, which carry
// addresses too. Workers Logs would keep every request, so the relay's
// `wrangler.toml` holds observability off and its source makes no logging
// call. This reads both as the index holds them.
//
// Usage: node scripts/check-link-relay-unlogged.mjs [--root <repo>]

import { resolve } from 'node:path';

import { indexedSources } from './lib/indexedSources.mjs';

const RELAY = 'link-relay';

/** The section a TOML line opens, or undefined for a line that opens none. */
function sectionOf(line) {
  const match = /^\s*\[\[?\s*([^\]]+?)\s*\]\]?\s*$/.exec(line);
  return match ? match[1] : undefined;
}

/** What breaks the relay's no-records rule, one line each; empty when it holds. */
function relayLoggingProblems(sources) {
  const problems = [];
  const config = sources.get(`${RELAY}/wrangler.toml`);
  if (config === undefined) {
    problems.push(`${RELAY}/wrangler.toml is not tracked`);
  } else {
    let section = '';
    let disabled = false;
    for (const raw of config.toString('utf8').split('\n')) {
      const line = raw.replace(/#.*/, '').trim();
      section = sectionOf(line) ?? section;
      const enabled = /^enabled\s*=\s*(true|false)$/.exec(line);
      if (!enabled || !section.startsWith('observability')) continue;
      if (enabled[1] === 'true') problems.push(`[${section}] enables logging`);
      else if (section === 'observability') disabled = true;
    }
    if (!disabled) problems.push('[observability] does not say enabled = false');
  }
  for (const [path, bytes] of sources) {
    if (!path.startsWith(`${RELAY}/src/`)) continue;
    bytes
      .toString('utf8')
      .split('\n')
      .forEach((line, index) => {
        if (/\bconsole\s*\./.test(line)) problems.push(`${path}:${index + 1} logs: ${line.trim()}`);
      });
  }
  return problems;
}

{
  const argv = process.argv.slice(2);
  const root = resolve(argv.includes('--root') ? argv[argv.indexOf('--root') + 1] : process.cwd());
  const problems = relayLoggingProblems(indexedSources(root, [RELAY]));
  if (problems.length > 0) {
    console.error(
      `check-link-relay-unlogged: the relay would keep records:\n  ${problems.join('\n  ')}`
    );
    process.exit(1);
  }
}
