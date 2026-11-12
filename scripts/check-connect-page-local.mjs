#!/usr/bin/env node
// The connect page loads nothing but its own files.
//
// It holds a link to the athlete's phone and shows their activities, so a
// script or style from another origin could read both. Every `src` and `href`
// in its HTML, every import in its modules and every `@import` or `url()` in
// its styles must be relative, and its content security policy must allow
// scripts and styles from itself only.
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
const BUNDLED = new Set(['react', 'react/jsx-runtime', 'react-dom/client']);

/** A module specifier that is neither a relative file nor a bundled package. */
const notRelative = (specifier) => !/^\.{1,2}\//.test(specifier) && !BUNDLED.has(specifier);

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
    names = readdirSync(join(root, BUILT));
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
