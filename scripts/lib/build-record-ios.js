// The record of what an iOS build was made from and what it packages.
//
// `expo run:ios` leaves a `.app` that names no inputs: the embedded bundle and
// the Rust archive Xcode linked are files that outlive the code that made
// them. So the record is written from the `.app` once the build has finished.
// It holds the hash of the inputs the tree held throughout, the bundle
// identifier and platform the app's Info.plist declares, the hash of the
// embedded JavaScript bundle (a debug app has none, Metro serves it), and the
// Rust archive the Xcode build phase linked: the manifest of the selection it
// was copied from, which names the SDK, profile, features and the Rust sources
// it was compiled from. The phase leaves that manifest beside the archive in
// the pod's products directory, a sibling of the `.app`. The record sits beside
// the `.app` too, never inside it, so the code signature is untouched.
//
// Writing refuses an archive built for another SDK than the app's, from other
// Rust sources than the tree holds, or that no longer matches the manifest's
// hash of it, and inputs that moved while the build ran. Verifying reads the
// app and the archive again and compares them with the record, the record's
// inputs with the tree as it is now, and the identity with what the install
// asked for.

const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { sourceIdentity } = require('./build-stamp.js');
const { BuildRecordError } = require('./build-record.js');
const { hashRustInputs } = require('../../modules/veloqrs/scripts/rust-inputs.js');

const FORMAT = 2;
const RUST_DIR = 'modules/veloqrs/rust';
const LINKED_DIR = 'Veloqrs';
const ARCHIVE = 'libveloqrs_ffi.a';
const ARCHIVE_MANIFEST = 'libveloqrs_ffi.manifest.json';
const BUNDLE = 'main.jsbundle';

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function recordPath(app) {
  return `${app.replace(/\/+$/, '')}.build.json`;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** An Info.plist as text, converting the binary form where a converter exists. */
function plistText(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.toString('latin1', 0, 6) !== 'bplist') return bytes.toString('utf8');
  for (const [tool, args] of [
    ['plutil', ['-convert', 'xml1', '-o', '-', file]],
    ['plistutil', ['-i', file, '-o', '-']],
  ]) {
    try {
      return execFileSync(tool, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      // Try the next converter.
    }
  }
  throw new BuildRecordError(`${file} is a binary plist and no converter is installed`);
}

function plistString(text, key) {
  const match = new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`).exec(text);
  return match ? match[1] : null;
}

/** What the `.app` carries, read out of the directory that gets installed. */
function appFacts(app) {
  if (!fs.existsSync(app)) throw new BuildRecordError(`no app at ${app}`);
  const plist = path.join(app, 'Info.plist');
  if (!fs.existsSync(plist)) throw new BuildRecordError(`${app} has no Info.plist`);
  const text = plistText(plist);
  const bundle = path.join(app, BUNDLE);
  const constants = readJson(path.join(app, 'EXConstants.bundle', 'app.config'));
  return {
    bundleId: plistString(text, 'CFBundleIdentifier'),
    platform: plistString(text, 'DTPlatformName'),
    bundle: fs.existsSync(bundle) ? sha256(fs.readFileSync(bundle)) : null,
    stamp: constants?.extra?.buildCommit ?? null,
  };
}

function sdkOf(manifest) {
  return String(manifest.targets?.[0] ?? '').split(':')[0];
}

/** What the linked Rust archive is, and the reasons it cannot be vouched for. */
function archiveFacts(root, app, platform) {
  const problems = [];
  const dir = path.join(path.dirname(path.resolve(app)), LINKED_DIR);
  const manifestFile = path.join(dir, ARCHIVE_MANIFEST);
  const manifest = readJson(manifestFile);
  if (!manifest) {
    problems.push(`no archive manifest at ${manifestFile}: the Rust build phase leaves it there`);
    return { problems, archive: null };
  }
  const archiveFile = path.join(dir, ARCHIVE);
  if (!fs.existsSync(archiveFile)) {
    problems.push(`no archive at ${archiveFile}`);
  } else if (sha256(fs.readFileSync(archiveFile)) !== manifest.files?.[ARCHIVE]) {
    problems.push('the linked Rust archive differs from the one its manifest describes');
  }
  const sdk = sdkOf(manifest);
  if (sdk !== platform) {
    problems.push(`the app is built for ${platform}, the linked Rust archive for ${sdk}`);
  }
  const sources = hashRustInputs(path.join(root, RUST_DIR));
  if (manifest.sources !== sources) {
    problems.push('the linked Rust archive was built from other Rust sources than the tree holds');
  }
  return {
    problems,
    archive: {
      manifest: sha256(fs.readFileSync(manifestFile)),
      sdk,
      profile: manifest.profile,
      features: manifest.features,
      sources: manifest.sources,
    },
  };
}

/**
 * Write the record for `app`, or throw naming every reason it cannot be
 * vouched for. `snapshot` is the identity taken before the build started: the
 * tree's inputs now must be the ones it held.
 */
function writeRecord(root, app, { variant, snapshot = null }) {
  const problems = [];
  const file = recordPath(app);
  fs.rmSync(file, { force: true });
  const source = sourceIdentity(root);
  if (!source) throw new BuildRecordError('the build was not made in a checkout');
  if (!snapshot) {
    throw new BuildRecordError(
      'no snapshot of the build inputs: take one before building with node scripts/build-record.js snapshot'
    );
  }
  const facts = appFacts(app);

  if (snapshot.inputs !== source.inputs) {
    problems.push(
      `the build inputs changed while the build ran (${snapshot.inputs} then ${source.inputs})`
    );
  }
  if (!facts.bundleId) problems.push('the app declares no CFBundleIdentifier');
  if (!facts.bundle && /^release$/i.test(variant)) {
    problems.push('the app carries no JavaScript bundle');
  }
  if (facts.stamp !== null && facts.stamp !== snapshot.stamp) {
    problems.push(`the app's configuration is stamped ${facts.stamp}, the tree ${snapshot.stamp}`);
  }
  const { problems: archiveProblems, archive } = archiveFacts(root, app, facts.platform);
  problems.push(...archiveProblems);
  if (problems.length) throw new BuildRecordError(problems.join('\n'));

  const record = {
    format: FORMAT,
    platform: 'ios',
    variant,
    source: {
      commit: source.commit,
      dirty: source.dirty,
      inputs: snapshot.inputs,
      stamp: snapshot.stamp,
    },
    application: { id: facts.bundleId, platform: facts.platform },
    javascript: { sha256: facts.bundle },
    archive,
  };
  fs.writeFileSync(file, `${JSON.stringify(record, null, 2)}\n`);
  return record;
}

function short(hash) {
  return String(hash ?? '').slice(0, 12);
}

function summarise(record) {
  const archive = record.archive ?? {};
  const features = archive.features?.length ? archive.features.join(',') : 'no features';
  return [
    `built from ${record.source.stamp} (inputs ${short(record.source.inputs)})`,
    `${record.application.id} ${record.variant} ${record.application.platform}`,
    `Rust ${archive.profile} ${archive.sdk} ${features}`,
    record.javascript.sha256 ? `bundle ${short(record.javascript.sha256)}` : 'bundle from Metro',
  ].join(', ');
}

/**
 * The reasons `app` is not the build asked for, empty when it is. `expect`
 * names the bundle identifier and, when a target is known, its platform.
 */
function verifyRecord(root, app, expect) {
  const file = recordPath(app);
  if (!fs.existsSync(file)) {
    return {
      problems: [`no build record at ${file}: build with npm run ios:prod, or npm run ios:record`],
      record: null,
      summary: '',
    };
  }
  const record = readJson(file);
  if (!record) {
    return { problems: [`the build record at ${file} is not JSON`], record: null, summary: '' };
  }
  if (record.format !== FORMAT || record.platform !== 'ios') {
    return {
      problems: [`the build record at ${file} is not a format ${FORMAT} iOS record`],
      record,
      summary: '',
    };
  }
  const problems = [];
  const facts = appFacts(app);
  if (facts.bundle !== record.javascript?.sha256) {
    problems.push('the app carries a bundle other than the one recorded');
  }
  if (facts.bundleId !== record.application?.id) {
    problems.push(`the app declares ${facts.bundleId}, the record ${record.application?.id}`);
  }
  if (facts.platform !== record.application?.platform) {
    problems.push(
      `the app is built for ${facts.platform}, the record ${record.application?.platform}`
    );
  }
  if (record.source.stamp !== facts.stamp && facts.stamp !== null) {
    problems.push(
      `the app's configuration is stamped ${facts.stamp}, the record ${record.source.stamp}`
    );
  }

  const { problems: archiveProblems, archive } = archiveFacts(root, app, facts.platform);
  problems.push(...archiveProblems);
  if (archive && archive.manifest !== record.archive?.manifest) {
    problems.push('the linked Rust archive is not the one the app was built with');
  }

  const now = sourceIdentity(root);
  if (!now) problems.push('there is no checkout to compare the build against');
  else if (now.inputs !== record.source.inputs) {
    problems.push(
      `the build inputs were ${short(record.source.inputs)} (${record.source.stamp}), the tree's are ${short(now.inputs)} (${now.stamp})`
    );
  }

  if (expect.bundleId && record.application?.id !== expect.bundleId) {
    problems.push(
      `the build is ${record.application?.id}, the install asked for ${expect.bundleId}`
    );
  }
  if (expect.platform && record.application?.platform !== expect.platform) {
    problems.push(
      `the build is for ${record.application?.platform}, the install is to ${expect.platform}`
    );
  }
  let summary = summarise(record);
  if (now && now.commit !== record.source.commit && now.inputs === record.source.inputs) {
    summary += `; HEAD ${now.commit} has the same inputs`;
  }
  return { problems, record, summary };
}

module.exports = { appFacts, recordPath, verifyRecord, writeRecord };
