#!/usr/bin/env node
// Build the connect page from web/connect/ into docs/connect/.
//
// Every script and style is named by a hash of its content, and the page is
// the template with those names written in. A file name is never reused for
// different bytes, so a browser holding a cached file from one deploy cannot
// pair it with a file from another. The output directory is emptied first, so
// nothing from an earlier build stays in it.
//
// Usage: node scripts/build-connect-page.mjs [--root <repo>] [--out <dir>]
//
// `--out` defaults to `docs/connect` under the root.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { build } from 'esbuild';

const SOURCE = 'web/connect';
const TEMPLATE = 'index.html';
/** Copied beside the output unchanged: the vendored encoder's licence. */
const NOTICES = ['qr.LICENSE.txt'];
/** The template's own names for what it loads, replaced by the built names. */
const ENTRIES = ['boot.ts', 'connect.css'];

function argument(argv, name) {
  const at = argv.indexOf(name);
  return at === -1 ? undefined : argv[at + 1];
}

/** The built file name for each entry, keyed by the entry's source name. */
function builtNames(metafile, root) {
  const names = new Map();
  for (const [output, meta] of Object.entries(metafile.outputs)) {
    if (!meta.entryPoint) continue;
    names.set(basename(meta.entryPoint), basename(output));
  }
  for (const entry of ENTRIES) {
    if (!names.has(entry)) throw new Error(`the build made nothing for ${entry} under ${root}`);
  }
  return names;
}

/** The template with each entry's source name replaced by its built name. */
function withBuiltNames(template, names) {
  let page = template;
  for (const entry of ENTRIES) {
    const attribute = new RegExp(`\\b(src|href)="${entry.replace('.', '\\.')}"`);
    if (!attribute.test(page)) throw new Error(`${TEMPLATE} does not load ${entry}`);
    page = page.replace(attribute, `$1="${names.get(entry)}"`);
  }
  return page;
}

export async function buildConnectPage({ root, out }) {
  const source = join(root, SOURCE);
  const template = readFileSync(join(source, TEMPLATE), 'utf8');
  for (const entry of ENTRIES) {
    if (!template.includes(`"${entry}"`)) throw new Error(`${TEMPLATE} does not load ${entry}`);
    if (!existsSync(join(source, entry))) throw new Error(`${SOURCE}/${entry} is missing`);
  }

  const result = await build({
    absWorkingDir: root,
    entryPoints: ENTRIES.map((entry) => join(SOURCE, entry)),
    outdir: out,
    bundle: true,
    splitting: true,
    format: 'esm',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    target: 'es2022',
    minify: true,
    sourcemap: 'external',
    entryNames: '[name]-[hash]',
    chunkNames: '[name]-[hash]',
    assetNames: '[name]-[hash]',
    metafile: true,
    write: false,
    logLevel: 'silent',
  });

  const names = builtNames(result.metafile, root);
  const page = withBuiltNames(template, names);

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const file of result.outputFiles) {
    const target = join(out, relative(out, file.path));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.contents);
  }
  writeFileSync(join(out, TEMPLATE), page);
  for (const notice of NOTICES) cpSync(join(source, notice), join(out, notice));
  return [...names.values()];
}

async function main() {
  const argv = process.argv.slice(2);
  const root = resolve(argument(argv, '--root') ?? process.cwd());
  const out = resolve(argument(argv, '--out') ?? join(root, 'docs/connect'));
  if (out === root || join(root, SOURCE).startsWith(`${out}/`) || out === join(root, SOURCE)) {
    console.error(`build-connect-page: refusing to empty ${out}, which holds the source.`);
    process.exit(1);
  }
  try {
    const entries = await buildConnectPage({ root, out });
    console.log(`build-connect-page: ${entries.join(', ')} in ${relative(root, out) || '.'}`);
  } catch (error) {
    console.error(`build-connect-page: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

await main();
