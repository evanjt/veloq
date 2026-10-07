#!/usr/bin/env node
// Write or verify the build record of an Android APK (`scripts/lib/build-record.js`).
//
//   node scripts/build-record.js snapshot release
//       before a build that bundles its own JavaScript (Gradle's release
//       variant, Xcode): takes the identity of the inputs the build starts from
//   node scripts/build-record.js write debug
//       after Gradle, from the APK it just packaged; a release APK reads the
//       snapshot taken before it
//   node scripts/build-record.js verify debug [--app-id ID] [--profile P]
//       [--features a,b] [--device-abis a,b]
//       before an install; exits 1 naming every mismatch
//   node scripts/build-record.js write-ios Release [--app PATH]
//   node scripts/build-record.js verify-ios Release [--app PATH]
//       [--bundle-id ID] [--platform iphonesimulator|iphoneos]
//       the same for a built `.app` (`scripts/lib/build-record-ios.js`), which
//       needs a snapshot from before the build
//
// Unless told otherwise, an install asks for the Dev identity (the production
// one when APP_VARIANT is production, as `app.config.js` reads it), the
// release Rust profile Gradle builds by default, and the features in
// VELOQRS_CARGO_FEATURES, as the Rust build reads them.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { BuildRecordError, apkFacts, verifyRecord, writeRecord } = require('./lib/build-record.js');
const ios = require('./lib/build-record-ios.js');
const { sourceIdentity } = require('./lib/build-stamp.js');

const ROOT = path.resolve(__dirname, '..');
const IDENTITIES = { development: 'com.veloq.app.dev', production: 'com.veloq.app' };

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
      applicationId:
        env.APP_VARIANT === 'production' ? IDENTITIES.production : IDENTITIES.development,
      profile: 'release',
      features: list(env.VELOQRS_CARGO_FEATURES),
      deviceAbis: [],
    },
  };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const value = rest[++i];
    if (value === undefined) throw new BuildRecordError(`${flag} needs a value`);
    if (flag === '--apk') options.apk = path.resolve(value);
    else if (flag === '--app-id') options.expect.applicationId = value;
    else if (flag === '--profile') options.expect.profile = value;
    else if (flag === '--features') options.expect.features = list(value);
    else if (flag === '--device-abis') options.expect.deviceAbis = list(value);
    else throw new BuildRecordError(`unknown argument ${flag}`);
  }
  return options;
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

/** The newest `.app` Xcode built for `variant` under DerivedData. */
function builtApp(variant) {
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
      bundleId: env.APP_VARIANT === 'production' ? IDENTITIES.production : IDENTITIES.development,
      platform: null,
    },
  };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const value = rest[++i];
    if (value === undefined) throw new BuildRecordError(`${flag} needs a value`);
    if (flag === '--app') options.app = path.resolve(value);
    else if (flag === '--bundle-id') options.expect.bundleId = value;
    else if (flag === '--platform') options.expect.platform = value;
    else throw new BuildRecordError(`unknown argument ${flag}`);
  }
  options.app ??= builtApp(variant);
  if (!options.app) throw new BuildRecordError(`no ${variant} .app found: pass --app PATH`);
  return options;
}

function main(argv = process.argv.slice(2), env = process.env) {
  const command = argv[0];
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
  if (command === 'write-ios' || command === 'verify-ios') {
    const options = parseIos(argv, env);
    if (command === 'write-ios') {
      const snapshot = readSnapshot('ios', options.variant);
      const record = ios.writeRecord(ROOT, options.app, { variant: options.variant, snapshot });
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
    const record = writeRecord(ROOT, options.apk, { variant: options.variant, snapshot });
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
    'usage: build-record.js snapshot|write|verify|write-ios|verify-ios [variant] [options]'
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

module.exports = { main };
