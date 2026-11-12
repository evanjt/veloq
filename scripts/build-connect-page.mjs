#!/usr/bin/env node
// Build the connect page from web/connect/ into docs/connect/.
//
// Every script and style is named by a hash of its content, and the page is
// the template with those names written in. A file name is never reused for
// different bytes, so a browser holding a cached file from one deploy cannot
// pair it with a file from another. The output directory is emptied first, so
// nothing from an earlier build stays in it.
//
// The page speaks every locale the app does. Each supported locale gets one
// chunk, `locales/<tag>-<hash>.json`, holding only the namespaces listed in
// `web/connect/namespaces.json`, with the locale's fallback chain already
// merged in so the page fetches one file. The page names the chunks in an
// inline data block.
//
// The page speaks a range of protocol versions (`web/connect/methods.json`
// names the newest and the oldest). The build is also published, whole, at
// `v<newest>/`, and every page in `web/connect/kept.json` is built from its
// commit at its own path, so a page for an older range stays online after the
// current one moves on. `builds.json` lists each build with the versions it
// speaks, which is how the current page finds an older one for a phone below
// its range.
//
// Usage: node scripts/build-connect-page.mjs [--root <repo>] [--out <dir>] [--plain]
//
// `--out` defaults to `docs/connect` under the root. `--plain` writes the page
// alone, which is how a kept page is built from its own commit.
//
// The map renderer is not bundled: it is the app's own vendored copy, a UMD
// build that sets a global, so it is copied from the basemap assets under a
// name carrying its hash and loaded as a classic script before the page's
// module. Its stylesheet and licence go beside it. The copies are refused
// unless they are the bytes `maplibreRenderer.generated.ts` pins, so the page's
// renderer is the one the app ships and a bump is one commit for both.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { build, transform } from 'esbuild';

import { gitFreeEnv } from './lib/indexedSources.mjs';

const SOURCE = 'web/connect';
const SCHEMA_INPUT = 'methods.json';
const KEPT = 'kept.json';
const BUILDS = 'builds.json';
/** What a kept page is built from at its commit: the page, its scripts and what it imports. */
const KEPT_SOURCES = [
  SOURCE,
  'scripts',
  'src',
  'modules/veloqrs/src',
  'modules/veloqrs/assets/basemap',
];
/** Where the template reaches the shared icon, one directory above the page. */
const ICON = 'href="../icon.png"';
const TEMPLATE = 'index.html';
/** Copied beside the output unchanged: the vendored encoder's licence. */
const NOTICES = ['qr.LICENSE.txt'];
/** The template's own names for what it loads, replaced by the built names. */
const ENTRIES = ['boot.ts', 'connect.css'];
/** Where the app keeps the renderer, and the module that pins its version and hashes. */
const RENDERER_DIR = 'modules/veloqrs/assets/basemap';
const RENDERER_PIN = 'src/features/maps/assets/maplibreRenderer.generated.ts';
/** The template's names for the renderer's files, and the pin's name for each. */
const RENDERER_FILES = [
  { template: 'maplibre-gl.js', pin: 'MAPLIBRE_GL_JS', stem: 'maplibre', extension: 'js' },
  { template: 'maplibre-gl.css', pin: 'MAPLIBRE_GL_CSS', stem: 'maplibre', extension: 'css' },
];
const RENDERER_LICENCE = { source: 'renderer/LICENSE.txt', stem: 'maplibre.LICENSE' };
const NAMESPACES = 'namespaces.json';
const LOCALES = 'src/i18n/locales';
const MANIFEST = /<script type="application\/json" id="locale-chunks">\s*<\/script>/;

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

function pinned(pin, name) {
  const found = new RegExp(`export const ${name} = '([^']+)'`).exec(pin);
  if (!found) throw new Error(`${RENDERER_PIN} does not pin ${name}`);
  return found[1];
}

/** A content hash in the shape esbuild names its files with: eight upper-case characters. */
const nameHash = (bytes) =>
  createHash('sha256').update(bytes).digest('hex').slice(0, 8).toUpperCase();

/**
 * The renderer's files read from the app's assets, each with the name the page
 * gets it under. Throws when a file is missing or is not the pinned bytes.
 */
function rendererFiles(root) {
  const pin = readFileSync(join(root, RENDERER_PIN), 'utf8');
  const files = RENDERER_FILES.map((file) => {
    const asset = pinned(pin, `${file.pin}_FILE`);
    const path = join(root, RENDERER_DIR, asset);
    if (!existsSync(path)) throw new Error(`${RENDERER_DIR}/${asset} is missing`);
    const bytes = readFileSync(path);
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (sha !== pinned(pin, `${file.pin}_SHA256`)) {
      throw new Error(`${RENDERER_DIR}/${asset} is not the bytes ${RENDERER_PIN} pins`);
    }
    return {
      template: file.template,
      name: `${file.stem}-${nameHash(bytes)}.${file.extension}`,
      bytes,
    };
  });
  const licencePath = join(root, RENDERER_DIR, RENDERER_LICENCE.source);
  if (!existsSync(licencePath)) {
    throw new Error(`${RENDERER_DIR}/${RENDERER_LICENCE.source} is missing`);
  }
  const licence = readFileSync(licencePath);
  files.push({
    template: null,
    name: `${RENDERER_LICENCE.stem}-${nameHash(licence)}.txt`,
    bytes: licence,
  });
  return files;
}

/** The template with each renderer file's template name replaced by its built name. */
function withRendererNames(page, files) {
  let built = page;
  for (const file of files) {
    if (!file.template) continue;
    const attribute = new RegExp(`\\b(src|href)="${file.template.replaceAll('.', '\\.')}"`);
    if (!attribute.test(built)) throw new Error(`${TEMPLATE} does not load ${file.template}`);
    built = built.replace(attribute, `$1="${file.name}"`);
  }
  return built;
}

/**
 * The app's theme index reaches react-native, which a browser does not have, so
 * the specifier `@/theme` resolves to the part of it the page's map styles read.
 */
function themeSubset(root) {
  return {
    name: 'theme-subset',
    setup(build) {
      build.onResolve({ filter: /^@\/theme$/ }, () => ({
        path: join(root, SOURCE, 'map/theme.ts'),
      }));
    },
  };
}

/**
 * The app's formatting module reads react-native, expo-localization and the
 * i18n singleton, none of which a browser has. For that module and the locale
 * helper beside it, and no other importer, those specifiers resolve to the
 * page's own small versions, so an import of the real package from anywhere
 * else still fails the build.
 */
const SHIMMED = [
  { filter: /^react-native$/, importers: ['src/shared/format/format.ts'], shim: 'reactNative.ts' },
  {
    filter: /^expo-localization$/,
    importers: ['src/shared/format/format.ts'],
    shim: 'expoLocalization.ts',
  },
  {
    filter: /^@\/i18n$/,
    importers: ['src/shared/format/format.ts', 'src/shared/format/locale.ts'],
    shim: 'appI18n.ts',
  },
  {
    filter: /^@\/i18n\/localeBundles$/,
    importers: ['src/shared/format/locale.ts'],
    shim: 'localeBundles.ts',
  },
];

function appShims(root) {
  return {
    name: 'app-shims',
    setup(build) {
      for (const { filter, importers, shim } of SHIMMED) {
        build.onResolve({ filter }, (args) => {
          // A checkout that links the app's source resolves to its real path, so the
          // importer is matched by the tail that names it.
          if (!importers.some((importer) => args.importer.endsWith(`/${importer}`))) {
            return undefined;
          }
          return { path: join(root, SOURCE, 'shims', shim) };
        });
      }
    },
  };
}

/** The app's supported tags and fallback chains, read from the type module. */
async function localeTables(root) {
  const source = readFileSync(join(root, 'src/i18n/types.ts'), 'utf8');
  const { code } = await transform(source, { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

function merge(base, over) {
  const result = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const held = result[key];
    const both = [value, held].every((x) => x && typeof x === 'object' && !Array.isArray(x));
    result[key] = both ? merge(held, value) : value;
  }
  return result;
}

/** One chunk per supported locale: file name to bytes, and tag to chunk path. */
async function localeChunks(root) {
  const { SUPPORTED_LOCALES, LOCALE_FALLBACKS } = await localeTables(root);
  const namespaces = JSON.parse(readFileSync(join(root, SOURCE, NAMESPACES), 'utf8'));
  const bundle = (tag) => JSON.parse(readFileSync(join(root, LOCALES, `${tag}.json`), 'utf8'));
  const files = new Map();
  const manifest = {};
  for (const tag of SUPPORTED_LOCALES) {
    const chain = LOCALE_FALLBACKS[tag] ?? [tag, 'en-GB'];
    const resolved = chain.reduceRight((held, each) => merge(held, bundle(each)), {});
    const chunk = Object.fromEntries(namespaces.map((name) => [name, resolved[name]]));
    const missing = namespaces.filter((name) => chunk[name] === undefined);
    if (missing.length) throw new Error(`${tag} has no ${missing.join(', ')} to put in its chunk`);
    const bytes = JSON.stringify(chunk);
    const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 10);
    const name = `${tag}-${hash}.json`;
    files.set(name, bytes);
    manifest[tag] = `locales/${name}`;
  }
  return { files, manifest };
}

export async function buildConnectPage({ root, out, plain = false }) {
  const source = join(root, SOURCE);
  const template = readFileSync(join(source, TEMPLATE), 'utf8');
  for (const entry of ENTRIES) {
    if (!template.includes(`"${entry}"`)) throw new Error(`${TEMPLATE} does not load ${entry}`);
    if (!existsSync(join(source, entry))) throw new Error(`${SOURCE}/${entry} is missing`);
  }
  const renderer = rendererFiles(root);

  const result = await build({
    absWorkingDir: root,
    // The page imports the app's pure modules by the alias the app uses.
    alias: { '@': join(root, 'src'), 'veloqrs/src': join(root, 'modules/veloqrs/src') },
    plugins: [themeSubset(root), appShims(root)],
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
  if (!MANIFEST.test(template)) throw new Error(`${TEMPLATE} has no locale-chunks block`);
  const locales = await localeChunks(root);
  const page = withRendererNames(withBuiltNames(template, names), renderer).replace(
    MANIFEST,
    () =>
      `<script type="application/json" id="locale-chunks">${JSON.stringify(locales.manifest)}</script>`
  );

  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const file of result.outputFiles) {
    const target = join(out, relative(out, file.path));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.contents);
  }
  mkdirSync(join(out, 'locales'), { recursive: true });
  for (const [name, bytes] of locales.files) writeFileSync(join(out, 'locales', name), bytes);
  writeFileSync(join(out, TEMPLATE), page);
  for (const notice of NOTICES) cpSync(join(source, notice), join(out, notice));
  for (const file of renderer) writeFileSync(join(out, file.name), file.bytes);
  const built = [...names.values(), ...renderer.map((file) => file.name)];
  if (plain) return built;
  const { protocol, minProtocol } = JSON.parse(readFileSync(join(source, SCHEMA_INPUT), 'utf8'));
  const current = `v${protocol}/`;
  const listed = [{ path: current, min: minProtocol, max: protocol }];
  // The same files again one directory down, the icon now two levels up.
  const versioned = join(out, current);
  for (const name of readdirSync(out).filter((name) => !/^v\d+$/.test(name))) {
    cpSync(join(out, name), join(versioned, name), { recursive: true });
  }
  writeFileSync(join(versioned, TEMPLATE), page.replace(ICON, 'href="../../icon.png"'));

  for (const kept of keptPages(source)) {
    if (listed.some((entry) => entry.path === kept.path)) {
      throw new Error(`${KEPT} names ${kept.path}, which the build already writes`);
    }
    buildKept({ root, out, kept });
    listed.push({ path: kept.path, min: kept.min, max: kept.max });
  }
  writeFileSync(join(out, BUILDS), `${JSON.stringify(listed, null, 2)}\n`);
  return built;
}

/** The pages `kept.json` asks to be kept online: path, versions spoken and commit. */
function keptPages(source) {
  const file = join(source, KEPT);
  if (!existsSync(file)) return [];
  const pages = JSON.parse(readFileSync(file, 'utf8'));
  for (const page of pages) {
    if (!/^v\d+\/$/.test(page.path) || ![page.min, page.max].every(Number.isInteger) || !page.ref) {
      throw new Error(`${KEPT}: ${JSON.stringify(page)} needs a path like v2/, min, max and ref`);
    }
  }
  return pages;
}

/** Build the page as it was at `kept.ref` into `kept.path` beside the current build. */
function buildKept({ root, out, kept }) {
  const git = (args, options = {}) =>
    execFileSync('git', args, {
      cwd: root,
      env: gitFreeEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options,
    });
  const scratch = mkdtempSync(join(tmpdir(), 'connect-kept-'));
  try {
    try {
      // The page imports the app's own modules, locales and map assets, so the
      // build at the commit reads every part of the tree the page draws on.
      const held = KEPT_SOURCES.filter(
        (path) => git(['ls-tree', '--name-only', kept.ref, '--', path]).length > 0
      );
      const archive = git(['archive', kept.ref, ...held], {
        maxBuffer: 256 * 1024 * 1024,
      });
      execFileSync('tar', ['-x', '-C', scratch], { input: archive });
    } catch (error) {
      const detail = error.stderr?.toString().trim() || error.message;
      throw new Error(`${KEPT}: cannot read ${kept.ref} for ${kept.path}: ${detail}`);
    }
    // The page's packages are resolved from the root it builds in.
    symlinkSync(join(root, 'node_modules'), join(scratch, 'node_modules'));
    const target = join(out, kept.path);
    execFileSync(
      process.execPath,
      [
        join(scratch, 'scripts/build-connect-page.mjs'),
        '--root',
        scratch,
        '--out',
        target,
        '--plain',
      ],
      { cwd: scratch, env: gitFreeEnv(), stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const index = join(target, TEMPLATE);
    writeFileSync(index, readFileSync(index, 'utf8').replace(ICON, 'href="../../icon.png"'));
  } catch (error) {
    if (error.stderr)
      throw new Error(`${KEPT}: ${kept.ref} did not build: ${error.stderr.toString().trim()}`);
    throw error;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
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
    const entries = await buildConnectPage({ root, out, plain: argv.includes('--plain') });
    console.log(`build-connect-page: ${entries.join(', ')} in ${relative(root, out) || '.'}`);
  } catch (error) {
    console.error(`build-connect-page: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

await main();
