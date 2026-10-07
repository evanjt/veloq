// The record of what an Android build was made from and what it packages.
//
// A commit stamp names where a build started and proves nothing about what
// Gradle packaged: the embedded bundle and the Rust library are files that
// outlive the code that made them, and Gradle packages whichever is there.
// So the record is written from the APK itself once Gradle has finished. It
// holds the hash of the inputs the tree held throughout the build, the
// package the compiled manifest declares, the hash of the bundle the APK
// carries and of the image each native library maps, and the Rust selection
// (targets, profile, features) those libraries were published under. Writing
// it refuses an APK whose bundle is not the one `bundle-android.mjs` built
// from those inputs, or whose Rust library is not one the builder published
// from the current Rust sources, and refuses outright when the inputs moved
// while the build ran.
//
// Verifying reads the APK again and compares: its packaged outputs against
// the record, the record's inputs against the tree as it is now, and the
// record's identity and selection against what the install asked for. The
// record keeps the commit that produced the build, so a later commit with the
// same inputs is reported as such and never relabelled.
//
// Nothing here claims byte-identical APKs: signing and packaging differ
// between builds, and the record speaks for the components only.

const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { sourceIdentity } = require('./build-stamp.js');
const { hashRustInputs } = require('../../modules/veloqrs/scripts/rust-inputs.js');

const FORMAT = 1;
const BUNDLE = 'android/app/src/main/assets/index.android.bundle';
// Beside the assets directory rather than in it, so it is never packaged.
const BUNDLE_RECORD = 'android/app/src/main/index.android.bundle.json';
const RUST_DIR = 'modules/veloqrs/rust';
const RUST_SELECTIONS = 'modules/veloqrs/build/rust/android';
const LIBRARY = 'libveloqrs.so';
const BRIDGE = 'libveloqrs_jni.so';

class BuildRecordError extends Error {}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function recordPath(apk) {
  return `${apk}.build.json`;
}

function unzip(args) {
  return execFileSync('unzip', args, { maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'ignore'] });
}

function apkEntries(apk) {
  return unzip(['-Z1', apk]).toString('utf8').split('\n').filter(Boolean);
}

function apkEntry(apk, entry) {
  return unzip(['-p', apk, entry]);
}

/**
 * A hash of what the dynamic loader maps from an ELF library: every loadable
 * segment's placement and bytes. The packager strips symbols, which removes
 * sections outside those segments and rewrites the section header fields of
 * the ELF header, so those fields are zeroed and the hash of the library the
 * builder published equals the hash of the one the APK carries.
 */
function loadImageHash(bytes) {
  if (bytes.length < 52 || bytes.toString('latin1', 0, 4) !== '\x7fELF') {
    throw new BuildRecordError('not an ELF library');
  }
  const is64 = bytes[4] === 2;
  const little = bytes[5] === 1;
  const u16 = (o) => (little ? bytes.readUInt16LE(o) : bytes.readUInt16BE(o));
  const u32 = (o) => (little ? bytes.readUInt32LE(o) : bytes.readUInt32BE(o));
  const word = (o) =>
    is64 ? Number(little ? bytes.readBigUInt64LE(o) : bytes.readBigUInt64BE(o)) : u32(o);
  const phoff = word(is64 ? 32 : 28);
  const phentsize = u16(is64 ? 54 : 42);
  const phnum = u16(is64 ? 56 : 44);
  // e_shoff, then e_shentsize, e_shnum and e_shstrndx.
  const sectionFields = is64
    ? [
        [40, 8],
        [58, 6],
      ]
    : [
        [32, 4],
        [46, 6],
      ];
  const hash = createHash('sha256').update(`load-image-v1:${is64 ? 64 : 32}\0`);
  for (let i = 0; i < phnum; i++) {
    const p = phoff + i * phentsize;
    if (u32(p) !== 1) continue;
    const [offset, vaddr, filesz, memsz, flags] = is64
      ? [word(p + 8), word(p + 16), word(p + 32), word(p + 40), u32(p + 4)]
      : [u32(p + 4), u32(p + 8), u32(p + 16), u32(p + 20), u32(p + 24)];
    if (offset + filesz > bytes.length) throw new BuildRecordError('a segment runs past the file');
    const segment = Buffer.from(bytes.subarray(offset, offset + filesz));
    for (const [at, length] of sectionFields) {
      const start = at - offset;
      if (start + length > 0 && start < segment.length) {
        segment.fill(0, Math.max(0, start), Math.min(segment.length, start + length));
      }
    }
    hash.update(`${vaddr}:${filesz}:${memsz}:${flags}\0`);
    hash.update(segment);
  }
  return hash.digest('hex');
}

/**
 * The `package` a compiled AndroidManifest.xml declares on its `manifest`
 * element: the string pool, then the first start element and its attributes.
 */
function manifestPackage(bytes) {
  if (bytes.length < 8 || bytes.readUInt16LE(0) !== 0x0003) {
    throw new BuildRecordError('AndroidManifest.xml is not a compiled manifest');
  }
  let strings = null;
  let at = bytes.readUInt16LE(2);
  while (at + 8 <= bytes.length) {
    const type = bytes.readUInt16LE(at);
    const headerSize = bytes.readUInt16LE(at + 2);
    const size = bytes.readUInt32LE(at + 4);
    if (size < 8) break;
    if (type === 0x0001) strings = stringPool(bytes.subarray(at, at + size));
    if (type === 0x0102 && strings) {
      const name = strings[bytes.readUInt32LE(at + 20)];
      const attributeStart = bytes.readUInt16LE(at + 24);
      const attributeSize = bytes.readUInt16LE(at + 26);
      const count = bytes.readUInt16LE(at + 28);
      if (name !== 'manifest') break;
      for (let i = 0; i < count; i++) {
        const a = at + headerSize + attributeStart + i * attributeSize;
        if (strings[bytes.readUInt32LE(a + 4)] !== 'package') continue;
        const raw = bytes.readInt32LE(a + 8);
        if (raw >= 0) return strings[raw];
        if (bytes[a + 15] === 0x03) return strings[bytes.readUInt32LE(a + 16)];
      }
      break;
    }
    at += size;
  }
  throw new BuildRecordError('AndroidManifest.xml declares no package');
}

function stringPool(chunk) {
  const count = chunk.readUInt32LE(8);
  const utf8 = (chunk.readUInt32LE(16) & 0x100) !== 0;
  const stringsStart = chunk.readUInt32LE(20);
  const headerSize = chunk.readUInt16LE(2);
  const strings = [];
  for (let i = 0; i < count; i++) {
    let at = stringsStart + chunk.readUInt32LE(headerSize + i * 4);
    if (utf8) {
      // Two lengths, characters then bytes, each one or two bytes long.
      at += chunk[at] & 0x80 ? 2 : 1;
      let length = chunk[at];
      if (length & 0x80) {
        length = ((length & 0x7f) << 8) | chunk[at + 1];
        at += 2;
      } else {
        at += 1;
      }
      strings.push(chunk.toString('utf8', at, at + length));
    } else {
      let length = chunk.readUInt16LE(at);
      if (length & 0x8000) {
        length = ((length & 0x7fff) << 16) | chunk.readUInt16LE(at + 2);
        at += 4;
      } else {
        at += 2;
      }
      strings.push(chunk.toString('utf16le', at, at + length * 2));
    }
  }
  return strings;
}

/** What the APK carries, read out of the file that gets installed. */
function apkFacts(apk) {
  if (!fs.existsSync(apk)) throw new BuildRecordError(`no APK at ${apk}`);
  const entries = new Set(apkEntries(apk));
  const facts = { applicationId: null, bundle: null, stamp: null, libraries: {}, bridges: {} };
  if (entries.has('AndroidManifest.xml')) {
    facts.applicationId = manifestPackage(apkEntry(apk, 'AndroidManifest.xml'));
  }
  if (entries.has('assets/index.android.bundle')) {
    facts.bundle = sha256(apkEntry(apk, 'assets/index.android.bundle'));
  }
  if (entries.has('assets/app.config')) {
    try {
      facts.stamp = JSON.parse(
        apkEntry(apk, 'assets/app.config').toString('utf8')
      ).extra?.buildCommit;
    } catch {
      facts.stamp = null;
    }
  }
  for (const entry of entries) {
    const match = /^lib\/([^/]+)\/([^/]+)$/.exec(entry);
    if (!match) continue;
    if (match[2] === LIBRARY) facts.libraries[match[1]] = loadImageHash(apkEntry(apk, entry));
    if (match[2] === BRIDGE) facts.bridges[match[1]] = loadImageHash(apkEntry(apk, entry));
  }
  return facts;
}

/**
 * Called by `bundle-android.mjs` once the export has finished, with the
 * identity it took before starting. A bundle whose inputs moved while Metro
 * read them is refused and left unrecorded, so no APK can be recorded from it.
 */
function recordBundle(root, before) {
  const file = path.join(root, BUNDLE_RECORD);
  fs.rmSync(file, { force: true });
  const after = sourceIdentity(root);
  if (!before || !after) throw new BuildRecordError('the bundle was not built in a checkout');
  if (before.inputs !== after.inputs) {
    throw new BuildRecordError(
      `the build inputs changed while the bundle was built (${before.inputs} then ${after.inputs}); build it again`
    );
  }
  const bundle = path.join(root, BUNDLE);
  if (!fs.existsSync(bundle)) throw new BuildRecordError(`no bundle at ${BUNDLE}`);
  const entry = {
    inputs: after.inputs,
    stamp: after.stamp,
    sha256: sha256(fs.readFileSync(bundle)),
  };
  fs.writeFileSync(file, `${JSON.stringify(entry, null, 2)}\n`);
  return entry;
}

function sameKeys(a, b) {
  return Object.keys(a).sort().join(',') === Object.keys(b).sort().join(',');
}

/** Whether two maps of ABI to hash name the same ABIs with the same hashes. */
function sameHashes(a, b) {
  return sameKeys(a, b) && Object.keys(a).every((abi) => a[abi] === b[abi]);
}

/**
 * The selection whose published libraries are the ones the APK carries, one
 * per ABI and no other ABI, with every file still as the builder wrote it.
 */
function packagedSelection(root, libraries) {
  const dir = path.join(root, RUST_SELECTIONS);
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
  for (const name of names) {
    const manifestFile = path.join(dir, name, 'manifest.json');
    if (!fs.existsSync(manifestFile)) continue;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
    } catch {
      continue;
    }
    const targets = [...(manifest.targets ?? [])].sort();
    if (targets.join(',') !== Object.keys(libraries).sort().join(',')) continue;
    const matches = targets.every((abi) => {
      const file = path.join(dir, name, 'jniLibs', abi, LIBRARY);
      return fs.existsSync(file) && loadImageHash(fs.readFileSync(file)) === libraries[abi];
    });
    if (!matches) continue;
    const intact = Object.entries(manifest.files ?? {}).every(([rel, hash]) => {
      const file = path.join(dir, name, rel);
      return fs.existsSync(file) && sha256(fs.readFileSync(file)) === hash;
    });
    if (intact) return { name, manifest };
  }
  return null;
}

/** Versions of the tools that generated what the build packaged. */
function generators(root) {
  const version = (name) => {
    try {
      const file = require.resolve(`${name}/package.json`, { paths: [root] });
      return JSON.parse(fs.readFileSync(file, 'utf8')).version;
    } catch {
      return null;
    }
  };
  return {
    node: process.version,
    expo: version('expo'),
    'react-native': version('react-native'),
    'uniffi-bindgen-react-native': version('uniffi-bindgen-react-native'),
  };
}

/**
 * Write the record for `apk`, or throw naming every reason it cannot be
 * vouched for. The tree's inputs now must be the ones the bundle was built
 * from, which is what ties the whole build to one snapshot of them.
 *
 * A build whose JavaScript Gradle bundles itself (the release variant) leaves
 * no bundle record, so it passes the identity taken before Gradle started as
 * `snapshot`: the inputs must not have moved since, and the bundle hash is
 * read from the APK, which is the only place that bundle exists.
 */
function writeRecord(root, apk, { variant, snapshot = null }) {
  const problems = [];
  const file = recordPath(apk);
  fs.rmSync(file, { force: true });
  const source = sourceIdentity(root);
  if (!source) throw new BuildRecordError('the build was not made in a checkout');
  const facts = apkFacts(apk);

  let bundle;
  if (snapshot) {
    bundle = { inputs: snapshot.inputs };
    if (!facts.bundle) {
      problems.push('the APK carries no JavaScript bundle');
    } else if (snapshot.inputs !== source.inputs) {
      problems.push(
        `the build inputs changed while the build ran (${snapshot.inputs} then ${source.inputs})`
      );
    }
  } else {
    const bundlePath = path.join(root, BUNDLE_RECORD);
    bundle = fs.existsSync(bundlePath) ? JSON.parse(fs.readFileSync(bundlePath, 'utf8')) : null;
    if (!facts.bundle) {
      problems.push('the APK carries no JavaScript bundle');
    } else if (!bundle) {
      problems.push('no record of how the bundle was built: run npm run bundle:android');
    } else {
      if (bundle.inputs !== source.inputs) {
        problems.push(
          `the build inputs changed after the bundle was built (${bundle.inputs} then ${source.inputs})`
        );
      }
      if (bundle.sha256 !== facts.bundle) {
        problems.push('the APK packages a bundle other than the one bundle-android built');
      }
    }
  }
  if (facts.stamp !== (snapshot?.stamp ?? source.stamp)) {
    problems.push(
      `the APK's configuration is stamped ${facts.stamp || 'nothing'}, the tree ${snapshot?.stamp ?? source.stamp}`
    );
  }
  if (!facts.applicationId) problems.push('the APK declares no package');

  let rust = null;
  if (Object.keys(facts.libraries).length === 0) {
    problems.push(`the APK carries no ${LIBRARY}`);
  } else {
    const selection = packagedSelection(root, facts.libraries);
    if (!selection) {
      problems.push(
        `the APK packages a Rust library the builder did not publish under ${RUST_SELECTIONS}`
      );
    } else {
      const sources = hashRustInputs(path.join(root, RUST_DIR));
      if (selection.manifest.sources !== sources) {
        problems.push(
          `the packaged Rust library ${selection.name} was built from other Rust sources`
        );
      }
      const { targets, triples, profile, features, api, fingerprint } = selection.manifest;
      rust = {
        selection: selection.name,
        targets,
        triples,
        profile,
        features,
        api,
        fingerprint,
        sources,
        libraries: facts.libraries,
      };
    }
  }
  if (!sameKeys(facts.bridges, facts.libraries)) {
    problems.push(`the APK's ${BRIDGE} ABIs differ from its ${LIBRARY} ABIs`);
  }
  if (problems.length) throw new BuildRecordError(problems.join('\n'));

  const record = {
    format: FORMAT,
    platform: 'android',
    variant,
    source: {
      commit: source.commit,
      dirty: source.dirty,
      inputs: source.inputs,
      stamp: source.stamp,
    },
    application: { id: facts.applicationId },
    javascript: { sha256: facts.bundle, inputs: bundle.inputs },
    rust,
    bridge: { libraries: facts.bridges },
    generators: generators(root),
  };
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

function short(hash) {
  return String(hash ?? '').slice(0, 12);
}

/** One line naming what a record says the build is. */
function summarise(record) {
  const rust = record.rust ?? {};
  const features = rust.features?.length ? rust.features.join(',') : 'no features';
  return [
    `built from ${record.source.stamp} (inputs ${short(record.source.inputs)})`,
    `${record.application.id} ${record.variant}`,
    `Rust ${rust.profile} ${(rust.targets ?? []).join(',')} ${features}`,
    `bundle ${short(record.javascript.sha256)}`,
  ].join(', ');
}

/**
 * The reasons `apk` is not the build asked for, empty when it is. `expect`
 * names the package, the Rust profile and features, and the handset's ABIs
 * when one is attached.
 */
function verifyRecord(root, apk, expect) {
  const file = recordPath(apk);
  if (!fs.existsSync(file)) {
    return {
      problems: [
        `no build record at ${file}: build with npm run android:debug or npm run android:prod`,
      ],
      record: null,
      summary: '',
    };
  }
  let record;
  try {
    record = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { problems: [`the build record at ${file} is not JSON`], record: null, summary: '' };
  }
  if (record.format !== FORMAT || record.platform !== 'android') {
    return {
      problems: [`the build record at ${file} is not a format ${FORMAT} Android record`],
      record,
      summary: '',
    };
  }
  const problems = [];
  const facts = apkFacts(apk);

  if (facts.bundle !== record.javascript?.sha256) {
    problems.push('the APK carries a bundle other than the one recorded');
  }
  if (facts.applicationId !== record.application?.id) {
    problems.push(`the APK declares ${facts.applicationId}, the record ${record.application?.id}`);
  }
  if (facts.stamp !== record.source?.stamp) {
    problems.push(
      `the APK's configuration is stamped ${facts.stamp}, the record ${record.source?.stamp}`
    );
  }
  const recorded = record.rust?.libraries ?? {};
  if (!sameHashes(facts.libraries, recorded)) {
    problems.push('the APK carries a Rust library other than the one recorded');
  }
  const bridges = record.bridge?.libraries ?? {};
  if (!sameHashes(facts.bridges, bridges)) {
    problems.push(`the APK carries a ${BRIDGE} other than the one recorded`);
  }

  const now = sourceIdentity(root);
  if (!now) problems.push('there is no checkout to compare the build against');
  else if (now.inputs !== record.source.inputs) {
    problems.push(
      `the build inputs were ${short(record.source.inputs)} (${record.source.stamp}), the tree's are ${short(now.inputs)} (${now.stamp})`
    );
  }

  if (expect.applicationId && record.application?.id !== expect.applicationId) {
    problems.push(
      `the build is ${record.application?.id}, the install asked for ${expect.applicationId}`
    );
  }
  if (expect.profile && record.rust?.profile !== expect.profile) {
    problems.push(
      `the Rust profile is ${record.rust?.profile}, the install asked for ${expect.profile}`
    );
  }
  const wanted = [...new Set(expect.features ?? [])].sort().join(',');
  const built = [...(record.rust?.features ?? [])].sort().join(',');
  if (expect.features && wanted !== built) {
    problems.push(
      `the Rust features are ${built || 'none'}, the install asked for ${wanted || 'none'}`
    );
  }
  const deviceAbis = expect.deviceAbis ?? [];
  if (deviceAbis.length && !deviceAbis.some((abi) => (record.rust?.targets ?? []).includes(abi))) {
    problems.push(
      `the build carries ${(record.rust?.targets ?? []).join(', ')}, the handset runs ${deviceAbis.join(', ')}`
    );
  }
  let summary = summarise(record);
  if (now && now.commit !== record.source.commit && now.inputs === record.source.inputs) {
    summary += `; HEAD ${now.commit} has the same inputs`;
  }
  return { problems, record, summary };
}

module.exports = {
  BUNDLE,
  BUNDLE_RECORD,
  BuildRecordError,
  apkFacts,
  loadImageHash,
  manifestPackage,
  recordBundle,
  recordPath,
  verifyRecord,
  writeRecord,
};
