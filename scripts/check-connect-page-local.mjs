#!/usr/bin/env node
// The connect page loads nothing but its own files.
//
// It holds a link to the athlete's phone and shows their activities, so a
// script or style from another origin could read both. Every `src` and `href`
// in its HTML, every import in its modules and every `@import` or `url()` in
// its styles must be relative, and its content security policy must allow
// scripts and styles from itself only.
//
// The map reaches two places beyond the page: the relay, and the host the
// basemap's tiles, glyphs and sprite come from. The policy names those two in
// `connect-src`, beside `'self'` for the page's own locale chunks, and nothing
// else, so a tile host added by hand, which would see the athlete's viewport,
// fails here. Workers and decoded images come from
// `blob:` and `data:`, which hold nothing the page did not fetch. Any other
// directive allows nothing beyond the page itself.
//
// The page's source, `web/connect/`, is read as the index holds it, so a
// commit that adds a foreign load fails there. The built output,
// `docs/connect/`, is not tracked: it is read off the disk when a build has
// made it, which is what the deploy uploads.
//
// Usage: node scripts/check-connect-page-local.mjs [--root <repo>]

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { treeSources } from './lib/indexedSources.mjs';

const SOURCE = 'web/connect';
const BUILT = 'docs/connect';

/** A reference that leaves the page's own origin: a scheme, or `//host`. */
const FOREIGN = /^\s*(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

/**
 * Packages the build bundles into the page's own files. A source may import
 * them; the built output, which is read too, may not import anything.
 */
const BUNDLED = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom/client',
  'i18next',
  'react-i18next',
]);

/** The app's source, which the build resolves `@/` to and bundles into the page's own files. */
const APP_SOURCE = /^@\//;

/** A module specifier that is neither a relative file, the app's source nor a bundled package. */
const notRelative = (specifier) =>
  !/^\.{1,2}\//.test(specifier) && !APP_SOURCE.test(specifier) && !BUNDLED.has(specifier);

/** The relay the page links through, and the host the basemap is drawn from. */
const RELAY = 'wss://auth.veloq.fit';
const BASEMAP = 'https://tiles.openfreemap.org';

/** What each directive of the policy may name, beyond `'none'`. Any directive not listed may name `'self'`. */
const ALLOWED_SOURCES = {
  'default-src': [],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'worker-src': ['blob:'],
  'img-src': ["'self'", 'data:', 'blob:'],
  'connect-src': ["'self'", RELAY, BASEMAP],
};

/** The policy's sources for one directive, or undefined when it has none. */
function directive(policy, name) {
  const part = policy
    .split(';')
    .map((piece) => piece.trim().split(/\s+/))
    .find(([key]) => key === name);
  return part?.slice(1);
}

function htmlProblems(path, text) {
  const problems = [];
  for (const match of text.matchAll(/\b(src|href)\s*=\s*["']([^"']*)["']/gi)) {
    if (FOREIGN.test(match[2]))
      problems.push(`${path}: ${match[1]}="${match[2]}" is another origin`);
  }
  const meta = /<meta[^>]*Content-Security-Policy[^>]*content="([^"]*)"/i.exec(text);
  const content = meta?.[1];
  if (!content) {
    problems.push(`${path}: no Content-Security-Policy meta`);
    return problems;
  }
  for (const name of ['script-src', 'style-src']) {
    const sources = directive(content, name) ?? directive(content, 'default-src');
    if (!sources || sources.some((source) => source !== "'self'")) {
      problems.push(`${path}: ${name} allows more than 'self'`);
    }
  }
  problems.push(...policyProblems(path, content));
  return problems;
}

/** Each directive's sources against what it may name; the fallback is `default-src`. */
function policyProblems(path, policy) {
  const problems = [];
  for (const piece of policy.split(';')) {
    const [name, ...sources] = piece.trim().split(/\s+/);
    if (!name) continue;
    const allowed = ALLOWED_SOURCES[name] ?? ["'self'"];
    for (const source of sources) {
      if (source !== "'none'" && !allowed.includes(source)) {
        problems.push(`${path}: ${name} allows ${source}, which the page does not need`);
      }
    }
  }
  return problems;
}

function scriptProblems(path, text) {
  const problems = [];
  const specifiers = [
    ...text.matchAll(/^\s*(?:import|export)\b[^'"]*?\bfrom\s*['"]([^'"]+)['"]/gm),
    ...text.matchAll(/^\s*import\s*['"]([^'"]+)['"]/gm),
    ...text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map((match) => match[1]);
  for (const specifier of specifiers) {
    if (notRelative(specifier))
      problems.push(`${path}: imports '${specifier}', not a file of the page`);
  }
  return problems;
}

function styleProblems(path, text) {
  const problems = [];
  const references = [
    ...text.matchAll(/@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)/g),
    ...text.matchAll(/url\(\s*['"]?([^'")\s]+)/g),
  ].map((match) => match[1]);
  for (const reference of references) {
    if (FOREIGN.test(reference) && !reference.startsWith('data:')) {
      problems.push(`${path}: loads ${reference}, another origin`);
    }
  }
  return problems;
}

/** What lets another origin into the page, one line each; empty when nothing does. */
function foreignLoads(sources) {
  const problems = [];
  let pages = 0;
  for (const [path, bytes] of sources) {
    const text = bytes.toString('utf8');
    if (path.endsWith('.html')) {
      pages++;
      problems.push(...htmlProblems(path, text));
    } else if (/\.(js|ts|tsx)$/.test(path)) problems.push(...scriptProblems(path, text));
    else if (path.endsWith('.css')) problems.push(...styleProblems(path, text));
  }
  if (pages === 0) problems.push(`${SOURCE} holds no page`);
  return problems;
}

/** The built output's files off the disk, keyed as the index keys them; empty when not built. */
function builtSources(root) {
  const sources = new Map();
  let names;
  try {
    names = readdirSync(join(root, BUILT), { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
  } catch {
    return sources;
  }
  for (const name of names) {
    sources.set(`${BUILT}/${name}`, readFileSync(join(root, BUILT, name)));
  }
  return sources;
}

{
  const argv = process.argv.slice(2);
  const root = resolve(argv.includes('--root') ? argv[argv.indexOf('--root') + 1] : process.cwd());
  const problems = foreignLoads(new Map([...treeSources(root, [SOURCE]), ...builtSources(root)]));
  if (problems.length > 0) {
    console.error(
      `check-connect-page-local: the connect page would load from another origin:\n  ${problems.join('\n  ')}`
    );
    process.exit(1);
  }
}
