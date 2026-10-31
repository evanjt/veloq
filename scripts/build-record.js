#!/usr/bin/env node
// Write or verify the build record of an Android APK (`scripts/lib/build-record.js`).
//
//   node scripts/build-record.js snapshot release
//       before a build that bundles its own JavaScript (Gradle's release
//       variant, Xcode): takes the identity of the inputs the build starts from
//   node scripts/build-record.js write debug
//       after Gradle, from the APK it just packaged; a release APK reads the
//       snapshot taken before it
//   node scripts/build-record.js verify debug [--identity dev|production]
//       [--app-id ID] [--profile P] [--features a,b] [--device-abis a,b]
//       before an install; exits 1 naming every mismatch
//   node scripts/build-record.js write-ios Release [--app PATH]
//   node scripts/build-record.js verify-ios Release [--app PATH]
//       [--identity dev|production] [--bundle-id ID]
//       [--platform iphonesimulator|iphoneos]
//       the same for a built `.app` (`scripts/lib/build-record-ios.js`), which
//       needs a snapshot from before the build
//   node scripts/build-record.js locate-ios Release [--identity dev|production]
//       prints the `.app` the two above read when no --app is given
//   node scripts/build-record.js identity <apk|aab|app|ipa> --variant dev|production
//       judges the file alone, with no record and no checkout state, and exits
//       1 naming its native, embedded and extension identities that are not
//       the selected one (`scripts/lib/artifact-identity.js`); CI runs it on
//       every artifact it builds or restores
//
// Writing refuses a build of another identity than APP_VARIANT selects
// (`scripts/lib/app-identity.js`, which `app.config.js` reads too), since that
// is the one the build was asked for. Verifying never reads APP_VARIANT: an
// install asks for an identity with --identity, or takes the one the record
// names, which writing proved was the one asked for. Unless told otherwise it
// asks for the Rust profile in VELOQRS_RUST_PROFILE (release-dev by default for
// a debug build, which is what the debug recipes compile, release otherwise), and
// the features in VELOQRS_CARGO_FEATURES, as the Rust build reads them.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { IDENTITIES, IdentityError, selected } = require('./lib/app-identity.js');
const { artifactIdentity, selectedIdentityProblems } = require('./lib/artifact-identity.js');
const { BuildRecordError, apkFacts, verifyRecord, writeRecord } = require('./lib/build-record.js');
const ios = require('./lib/build-record-ios.js');
const { sourceIdentity } = require('./lib/build-stamp.js');

const ROOT = path.resolve(__dirname, '..');

function selectedAppId(env) {
  try {
    return selected(env).appId;
  } catch (error) {
    if (error instanceof IdentityError) throw new BuildRecordError(error.message);
    throw error;
  }
}

/** The package an `--identity` names. */
function identityAppId(name) {
  if (!Object.hasOwn(IDENTITIES, name)) {
    throw new BuildRecordError(`--identity ${name} names no identity; use dev or production`);
  }
  return IDENTITIES[name].appId;
}

function list(text) {
  return [
    ...new Set(
      String(text ?? '')
        .split(/[\s,]+/)
        .filter(Boolean)
    ),
  ].sort();
}

function parse(argv, env) {
  const [command, variant = 'debug', ...rest] = argv;
  if (!/^[a-z]+$/i.test(variant)) throw new BuildRecordError(`unknown variant ${variant}`);
  const options = {
    command,
    variant,
    apk: path.join(ROOT, `android/app/build/outputs/apk/${variant}/app-${variant}.apk`),
    expect: {
      applicationId: null,
      profile: null,
      features: list(env.VELOQRS_CARGO_FEATURES),
      deviceAbis: [],
    },
  };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const value = rest[++i];
    if (value === undefined) throw new BuildRecordError(`${flag} needs a value`);
    if (flag === '--apk') options.apk = path.resolve(value);
    else if (flag === '--identity') options.expect.applicationId = identityAppId(value);
    else if (flag === '--app-id') options.expect.applicationId = value;
    else if (flag === '--profile') options.expect.profile = value;
    else if (flag === '--features') options.expect.features = list(value);
    else if (flag === '--device-abis') options.expect.deviceAbis = list(value);
    else throw new BuildRecordError(`unknown argument ${flag}`);
  }
  // With no identity asked for, the profile follows the identity the record names.
  if (!options.expect.profile) {
    if (options.expect.applicationId || variant.toLowerCase() === 'release') {
      options.expect.profile = rustProfile(variant, options.expect.applicationId, env);
    } else {
      options.expect.profileFor = (applicationId) => rustProfile(variant, applicationId, env);
    }
  }
  return options;
}

/**
 * The Rust profile a build of `variant` and `applicationId` compiles. A release
 * build and production both build Rust release, as the Rust build decides,
 * unless VELOQRS_NON_SHIPPING=1 marks the build as one that cannot ship, and
 * then the selected profile applies. The release lanes set no marker, so they
 * expect release and refuse an artifact the record says is release-dev. A
 * debug build is made by `npm run android` or `npm run android:debug`, which
 * compile release-dev unless the caller selected a profile.
 */
function rustProfile(variant, applicationId, env) {
  if (env.VELOQRS_NON_SHIPPING === '1') return env.VELOQRS_RUST_PROFILE || 'release';
  if (applicationId === IDENTITIES.production.appId || variant.toLowerCase() === 'release') {
    return 'release';
  }
  return env.VELOQRS_RUST_PROFILE || 'release-dev';
}

// Under the Rust build directory, which git ignores and no build reads as input.
function snapshotFile(platform, variant) {
  return path.join(ROOT, 'modules/veloqrs/build/source-identity', `${platform}-${variant}.json`);
}

function readSnapshot(platform, variant) {
  try {
    return JSON.parse(fs.readFileSync(snapshotFile(platform, variant), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The newest `.app` Xcode built for `variant` under DerivedData, of `bundleId`
 * when one is named. Each identity is its own Xcode project, so both apps sit
 * there at once and the newest alone may be the other one.
 */
function builtApp(variant, bundleId = null) {
  const derived = path.join(os.homedir(), 'Library/Developer/Xcode/DerivedData');
  if (!fs.existsSync(derived)) return null;
  const found = [];
  for (const project of fs.readdirSync(derived)) {
    const products = path.join(derived, project, 'Build/Products');
    if (!fs.existsSync(products)) continue;
    for (const target of fs.readdirSync(products)) {
      if (!target.startsWith(`${variant}-iphone`)) continue;
      for (const name of fs.readdirSync(path.join(products, target))) {
        if (!name.endsWith('.app')) continue;
        const full = path.join(products, target, name);
        if (bundleId && ios.appBundleId(full) !== bundleId) continue;
        found.push({ full, time: fs.statSync(full).mtimeMs });
      }
    }
  }
  return found.sort((a, b) => b.time - a.time)[0]?.full ?? null;
}

function parseIos(argv, env) {
  const [command, variant = 'Release', ...rest] = argv;
  if (!/^[a-z]+$/i.test(variant)) throw new BuildRecordError(`unknown variant ${variant}`);
  const options = {
    command,
    variant,
    app: null,
    expect: {
      bundleId: command === 'write-ios' ? selectedAppId(env) : null,
      platform: null,
    },
  };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const value = rest[++i];
    if (value === undefined) throw new BuildRecordError(`${flag} needs a value`);
    if (flag === '--app') options.app = path.resolve(value);
    else if (flag === '--identity') options.expect.bundleId = identityAppId(value);
    else if (flag === '--bundle-id') options.expect.bundleId = value;
    else if (flag === '--platform') options.expect.platform = value;
    else throw new BuildRecordError(`unknown argument ${flag}`);
  }
  options.app ??= builtApp(variant, options.expect.bundleId);
  if (!options.app) {
    const of = options.expect.bundleId ? ` of ${options.expect.bundleId}` : '';
    throw new BuildRecordError(`no ${variant} .app${of} found: pass --app PATH`);
  }
  return options;
}

/** `identity <artifact> --variant V`: the variant is required, never read from the environment. */
function checkIdentity(argv) {
  const [, file, ...rest] = argv;
  let variant = null;
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const value = rest[++i];
    if (flag !== '--variant' || value === undefined) {
      throw new BuildRecordError(`unknown argument ${flag}`);
    }
    variant = value;
  }
  if (!file || variant === null) {
    throw new BuildRecordError(
      'usage: build-record.js identity <apk|aab|app|ipa> --variant dev|production'
    );
  }
  if (variant !== 'dev' && variant !== 'production') {
    throw new BuildRecordError(`--variant ${variant} names no identity; use dev or production`);
  }
  const { appId } = selected({ APP_VARIANT: variant });
  const problems = selectedIdentityProblems(file, artifactIdentity(path.resolve(file)), appId);
  for (const problem of problems) console.error(`build-record: ${path.basename(file)}: ${problem}`);
  if (!problems.length) console.log(`build-record: ${path.basename(file)} is ${appId} throughout`);
  return problems.length ? 1 : 0;
}

function main(argv = process.argv.slice(2), env = process.env) {
  const command = argv[0];
  if (command === 'identity') return checkIdentity(argv);
  if (command === 'snapshot') {
    const [, platform, variant = 'release'] = argv;
    const identity = sourceIdentity(ROOT);
    if (!identity) throw new BuildRecordError('the build is not in a checkout');
    const file = snapshotFile(platform === 'ios' ? 'ios' : 'android', variant);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(identity)}\n`);
    console.log(`build-record: snapshot of ${platform} ${variant} inputs at ${identity.stamp}`);
    return 0;
  }
  if (command === 'locate-ios') {
    console.log(parseIos(argv, env).app);
    return 0;
  }
  if (command === 'write-ios' || command === 'verify-ios') {
    const options = parseIos(argv, env);
    if (command === 'write-ios') {
      const snapshot = readSnapshot('ios', options.variant);
      const record = ios.writeRecord(ROOT, options.app, {
        variant: options.variant,
        snapshot,
        identity: options.expect.bundleId,
      });
      console.log(`build-record: ${path.basename(options.app)} built from ${record.source.stamp}`);
      return 0;
    }
    const { problems, summary } = ios.verifyRecord(ROOT, options.app, options.expect);
    if (summary) console.log(`build-record: ${summary}`);
    for (const problem of problems) console.error(`build-record: ${problem}`);
    return problems.length ? 1 : 0;
  }
  const options = parse(argv, env);
  if (options.command === 'write') {
    const snapshot = options.variant === 'debug' ? null : readSnapshot('android', options.variant);
    if (options.variant !== 'debug' && !snapshot) {
      throw new BuildRecordError(
        `no snapshot of the ${options.variant} build inputs: run node scripts/build-record.js snapshot android ${options.variant} before building`
      );
    }
    const record = writeRecord(ROOT, options.apk, {
      variant: options.variant,
      snapshot,
      identity: selectedAppId(env),
    });
    console.log(
      `build-record: ${path.relative(ROOT, options.apk)} built from ${record.source.stamp}`
    );
    return 0;
  }
  if (options.command === 'verify') {
    const { problems, summary } = verifyRecord(ROOT, options.apk, options.expect);
    // The stamp is the APK's own, so a file with no record still says which
    // commit it was cut from.
    const stamp = apkFacts(options.apk).stamp ?? 'nothing';
    console.log(
      `build-record: the APK is stamped ${stamp}, the tree is ${sourceIdentity(ROOT)?.stamp}`
    );
    if (summary) console.log(`build-record: ${summary}`);
    for (const problem of problems) console.error(`build-record: ${problem}`);
    return problems.length ? 1 : 0;
  }
  throw new BuildRecordError(
    'usage: build-record.js snapshot|write|verify|write-ios|verify-ios|locate-ios|identity [variant] [options]'
  );
}

if (require.main === module) {
  try {
    process.exit(main());
  } catch (error) {
    console.error(
      `build-record: ${error instanceof BuildRecordError ? error.message : error.stack}`
    );
    process.exit(error instanceof BuildRecordError ? 1 : 2);
  }
}

module.exports = { main, parse };
