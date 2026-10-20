#!/usr/bin/env node
// Reads `node_modules` on purpose: this patches the installed package, which is the
// environment and not a tracked file.
//
// expo-router resolves a link, a push or a replace by walking down the navigators the target
// shares with the screens open, and it takes a route open as the target's when the two carry the
// same name and, for a dynamic route, the same parameter. It finds the parameter only in a name
// that is one dynamic segment, `[id]`, so a route whose name spans a directory, `activity/[id]`,
// counts as the target whatever its id. A second activity then lands inside the open activity's
// own navigator rather than on a screen of its own. This compares the two routes by their
// singular id, the name with each dynamic segment filled from the route's params, which is how
// the same file already decides whether a link pops to a route.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const FILE = 'build/global-state/resolveNavigationDestination.js';
const VERSION = '58.0.23';
const EXPECTED = '2ceadf0d049b7eddbdc45b83d3499368e62ff6198487c863cf6b79c064c5b588';
const hash = (source) => createHash('sha256').update(source).digest('hex');

const SHIPPED = `    const dynamic = (0, _matchers.matchDynamicName)(targetRoute.name);
    return !dynamic || targetRoute.params?.[dynamic.name] === currentRoute.params?.[dynamic.name];
}
`;
const PATCHED = `    return (0, _getSingularId.getSingularId)(targetRoute.name, {
        params: targetRoute.params
    }) === (0, _getSingularId.getSingularId)(currentRoute.name, {
        params: currentRoute.params
    });
}
`;

function replaceOnce(source, from, to) {
  const at = source.indexOf(from);
  if (at === -1 || at !== source.lastIndexOf(from)) throw new Error('Router source changed');
  return source.slice(0, at) + to + source.slice(at + from.length);
}

/** The source with the patch taken out, which is what the package ships. */
function unpatchSource(source) {
  return source.includes(PATCHED) ? source.replace(PATCHED, SHIPPED) : source;
}

function patchSource(source, expectedHash = EXPECTED) {
  if (hash(source) === expectedHash) return replaceOnce(source, SHIPPED, PATCHED);
  const original = unpatchSource(source);
  if (hash(original) !== expectedHash || replaceOnce(original, SHIPPED, PATCHED) !== source) {
    throw new Error('Router source changed');
  }
  return source;
}

function applyPatch(root, check = false, expectedHash = EXPECTED) {
  const modules = path.join(root, 'node_modules');
  const entry = path.join(modules, 'expo-router');
  if (!fs.existsSync(entry)) throw new Error('expo-router is missing');
  const version = JSON.parse(fs.readFileSync(path.join(entry, 'package.json'), 'utf8')).version;
  if (version !== VERSION) {
    throw new Error(`Router route match patch requires version ${VERSION}, found ${version}`);
  }
  const original = fs.readFileSync(path.join(entry, FILE), 'utf8');
  const patched = patchSource(original, expectedHash);
  if (check) {
    if (original !== patched) throw new Error('Router route match patch is missing');
    return;
  }
  if (original === patched) return;
  if (fs.lstatSync(modules).isSymbolicLink()) {
    throw new Error('Router patch cannot write through a shared node_modules link');
  }
  if (fs.lstatSync(entry).isSymbolicLink()) {
    const copy = fs.mkdtempSync(path.join(modules, '.expo-router-'));
    fs.cpSync(fs.realpathSync(entry), copy, { recursive: true });
    fs.unlinkSync(entry);
    fs.renameSync(copy, entry);
  }
  fs.writeFileSync(path.join(entry, FILE), patched);
}

if (require.main === module) {
  try {
    applyPatch(process.cwd(), process.argv.includes('--check'));
  } catch (error) {
    console.error(`patch-expo-router-route-match: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { patchSource, unpatchSource, applyPatch, FILE, VERSION };
