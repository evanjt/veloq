#!/usr/bin/env node
// Reads `node_modules` on purpose: this patches the installed package, which is the
// environment and not a tracked file.
//
// React Native 0.87 and later install a TurboModule's JSI bindings only through
// `installJSIBindingsWithRuntime:callInvoker:`. nitro-modules 0.35 implements the
// one-argument selector alone, so on iOS nothing installs `NitroModulesProxy` and the
// app aborts at launch with "installJSIBindingsWithRuntime: was not called". This gives
// the nitro TurboModule the two-argument selector, caching the invoker it is handed and
// installing through the same path, which is the change nitro-modules 0.36.2 made.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const FILE = 'ios/turbomodule/NativeNitroModules+NewArch.mm';
const VERSION = '0.35.6';
const EXPECTED = 'c58762a11b9efe137fa76e8f5d103b3305c4ba50889a6119ea551a3d883860b0';
const hash = (source) => createHash('sha256').update(source).digest('hex');

const SHIPPED = `- (void)installJSIBindingsWithRuntime:(jsi::Runtime&)runtime {
  // 1. Get CallInvoker we cached statically
`;
const PATCHED = `- (void)installJSIBindingsWithRuntime:(jsi::Runtime&)runtime
                          callInvoker:(const std::shared_ptr<react::CallInvoker>&)callInvoker {
  _callInvoker = callInvoker;
  [self installNitroInRuntime:runtime];
}

- (void)installJSIBindingsWithRuntime:(jsi::Runtime&)runtime {
  [self installNitroInRuntime:runtime];
}

- (void)installNitroInRuntime:(jsi::Runtime&)runtime {
  // 1. Get CallInvoker we cached statically
`;

function replaceOnce(source, from, to) {
  const at = source.indexOf(from);
  if (at === -1 || at !== source.lastIndexOf(from)) throw new Error('Nitro source changed');
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
    throw new Error('Nitro source changed');
  }
  return source;
}

function applyPatch(root, check = false, expectedHash = EXPECTED) {
  const modules = path.join(root, 'node_modules');
  const entry = path.join(modules, 'react-native-nitro-modules');
  if (!fs.existsSync(entry)) throw new Error('react-native-nitro-modules is missing');
  const version = JSON.parse(fs.readFileSync(path.join(entry, 'package.json'), 'utf8')).version;
  if (version !== VERSION) {
    throw new Error(`Nitro JSI install patch requires version ${VERSION}, found ${version}`);
  }
  const original = fs.readFileSync(path.join(entry, FILE), 'utf8');
  const patched = patchSource(original, expectedHash);
  if (check) {
    if (original !== patched) throw new Error('Nitro JSI install patch is missing');
    return;
  }
  if (original === patched) return;
  if (fs.lstatSync(modules).isSymbolicLink()) {
    throw new Error('Nitro patch cannot write through a shared node_modules link');
  }
  if (fs.lstatSync(entry).isSymbolicLink()) {
    const copy = fs.mkdtempSync(path.join(modules, '.nitro-'));
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
    console.error(`patch-nitro-jsi-install: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { patchSource, unpatchSource, applyPatch, FILE, VERSION };
