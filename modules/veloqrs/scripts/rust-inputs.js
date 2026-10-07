// The files the Rust library is compiled from, and one hash over them. The
// native builds skip Cargo when this hash is unchanged and CI restores a cached
// library on it, so it must cover everything rustc reads: every source, the
// manifests, lockfile and Cargo configuration, and every file a source embeds
// with `include_str!`, `include_bytes!` or `include!`, which is how migration
// SQL reaches the library. Anything else under the tree (fixtures, docs, build
// output) leaves it alone.
//
// Usage: node rust-inputs.js [rustDir]   prints the hash, taking the Cargo
// features from VELOQRS_CARGO_FEATURES as the builds do, exits 1 naming an
// embed it cannot resolve.

const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SKIPPED_DIRECTORIES = new Set(['target', '.git', 'node_modules']);
const MANIFESTS = new Set(['Cargo.toml', 'Cargo.lock']);

const INCLUDE = /\b(include_str|include_bytes|include)!\s*\(/g;
// A plain or raw string literal and the closing parenthesis after it.
const LITERAL = /^\s*(?:"((?:[^"\\]|\\.)*)"|r(#*)"([\s\S]*?)"\2)\s*,?\s*\)/;

function isManifest(dir, name) {
  return MANIFESTS.has(name) || (path.basename(dir) === '.cargo' && name === 'config.toml');
}

function walk(dir, sources, manifests) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, sources, manifests);
    else if (entry.name.endsWith('.rs')) sources.push(full);
    else if (isManifest(dir, entry.name)) manifests.push(full);
  }
}

const IDENTIFIER = /[A-Za-z0-9_]/;

/** Whether a raw string (`r"`, `r#"`, `br"`, `cr"`) opens at `i`. */
function rawStringStart(source, i) {
  if (source[i] !== 'r' || !/^r#*"/.test(source.slice(i, i + 258))) return false;
  const before = source[i - 1] ?? '';
  if (!IDENTIFIER.test(before)) return true;
  return (before === 'b' || before === 'c') && !IDENTIFIER.test(source[i - 2] ?? '');
}

/**
 * The source with comments and the insides of string and character literals
 * blanked, offsets and line numbers kept, so only code can name an include.
 * Block comments nest in Rust, and a `//` or `/*` inside a string is not one.
 */
function codeOnly(source) {
  const out = source.split('');
  const blank = (from, to) => {
    for (let i = from; i < to; i++) if (out[i] !== '\n') out[i] = ' ';
  };
  let i = 0;
  while (i < source.length) {
    const rest = source.slice(i, i + 2);
    if (rest === '//') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
    } else if (rest === '/*') {
      let depth = 0;
      let j = i;
      do {
        if (source.startsWith('/*', j)) {
          depth++;
          j += 2;
        } else if (source.startsWith('*/', j)) {
          depth--;
          j += 2;
        } else {
          j++;
        }
      } while (depth > 0 && j < source.length);
      blank(i, j);
      i = j;
    } else if (source[i] === '"') {
      let j = i + 1;
      while (j < source.length && source[j] !== '"') j += source[j] === '\\' ? 2 : 1;
      blank(i + 1, j);
      i = j + 1;
    } else if (rawStringStart(source, i)) {
      const hashes = /^r(#*)"/.exec(source.slice(i))[1];
      const open = i + hashes.length + 2;
      const close = source.indexOf(`"${hashes}`, open);
      const stop = close === -1 ? source.length : close;
      blank(open, stop);
      i = stop + hashes.length + 1;
    } else if (source[i] === "'") {
      // A character literal, or else a lifetime, which has no closing quote.
      const literal = /^'(?:\\u\{[0-9A-Fa-f]+\}|\\x[0-9A-Fa-f]{2}|\\.|[^\\'\n])'/u.exec(
        source.slice(i)
      );
      if (literal) blank(i + 1, i + literal[0].length - 1);
      i += literal ? literal[0].length : 1;
    } else {
      i++;
    }
  }
  return out.join('');
}

/** The files `file` embeds, resolved beside it as rustc does. */
function embeddedFiles(file, rustDir) {
  const source = fs.readFileSync(file, 'utf8');
  const code = codeOnly(source);
  const found = [];
  for (const match of code.matchAll(INCLUDE)) {
    const line = code.slice(0, match.index).split('\n').length;
    const where = `${path.relative(rustDir, file)}:${line}`;
    const literal = LITERAL.exec(source.slice(match.index + match[0].length));
    if (!literal) {
      throw new Error(
        `${where} calls ${match[1]}! without a literal path, so its input cannot be named before compiling`
      );
    }
    const target = literal[1] ?? literal[3];
    if (literal[1]?.includes('\\')) {
      throw new Error(
        `${where} embeds a path with an escape sequence, which this reader does not decode`
      );
    }
    const resolved = path.resolve(path.dirname(file), target);
    if (!fs.existsSync(resolved)) {
      throw new Error(`${where} embeds ${target}, which does not exist`);
    }
    found.push(resolved);
  }
  return found;
}

/** Every file the library is compiled from, sorted. */
function rustInputFiles(dir) {
  const rustDir = path.resolve(dir);
  const sources = [];
  const manifests = [];
  walk(rustDir, sources, manifests);
  const buildScript = sources.find((file) => path.basename(file) === 'build.rs');
  if (buildScript) {
    throw new Error(
      `${path.relative(rustDir, buildScript)} is a build script, and the files it reads cannot be named from its source`
    );
  }
  const inputs = new Set([...sources, ...manifests]);
  for (const file of sources) {
    for (const embedded of embeddedFiles(file, rustDir)) inputs.add(embedded);
  }
  return [...inputs].sort();
}

/** A feature list from comma or space separated text, deduplicated and sorted. */
function parseFeatures(raw) {
  return [...new Set((raw ?? '').split(/[\s,]+/).filter(Boolean))].sort();
}

// The features change what the library contains without touching a source
// file, so they are part of its identity. None leaves the hash as it was, which
// keeps the cache keys of the default build.
function hashRustInputs(dir, features = []) {
  const rustDir = path.resolve(dir);
  const hash = createHash('sha256').update('rust-inputs-v2\0');
  const named = parseFeatures(features.join(','));
  if (named.length > 0) hash.update(`features:${named.join(',')}\0`);
  for (const file of rustInputFiles(rustDir)) {
    hash.update(`${path.relative(rustDir, file).split(path.sep).join('/')}\0`);
    hash.update(createHash('sha256').update(fs.readFileSync(file)).digest());
  }
  return hash.digest('hex');
}

module.exports = { rustInputFiles, hashRustInputs, parseFeatures };

if (require.main === module) {
  try {
    const dir = path.resolve(process.argv[2] ?? path.join(__dirname, '../rust'));
    console.log(hashRustInputs(dir, parseFeatures(process.env.VELOQRS_CARGO_FEATURES)));
  } catch (error) {
    console.error(`rust-inputs: ${error.message}`);
    process.exit(1);
  }
}
