// The two identities the app is built under, and which one a build selects.
//
// `app.config.js` names the app from here, the build record expects the
// package from here, and `scripts/prepare-native.mjs` compares a generated
// native project with it. The workflows keep their own literals because a
// workflow expression cannot read a file, and each names this one beside them.
//
//   node scripts/lib/app-identity.js appId
//       prints the selected identity's package, for shell scripts

const fs = require('node:fs');
const path = require('node:path');

const IDENTITIES = {
  dev: { variant: 'dev', name: 'Veloq Dev', appId: 'com.veloq.app.dev' },
  production: { variant: 'production', name: 'Veloq', appId: 'com.veloq.app' },
};

class IdentityError extends Error {}

/**
 * The identity `APP_VARIANT` selects: `production`, or Dev when it is unset,
 * empty or `dev`. Anything else is refused, because a typo that fell back to
 * Dev would build the wrong app under the name the caller asked for.
 */
function selected(env = process.env) {
  const variant = env.APP_VARIANT;
  if (variant === undefined || variant === '' || variant === 'dev') return IDENTITIES.dev;
  if (variant === 'production') return IDENTITIES.production;
  throw new IdentityError(
    `APP_VARIANT=${variant} names no identity; use production, or dev or unset for Veloq Dev`
  );
}

/** The `applicationId` a generated Android project builds, or null when there is none. */
function androidAppId(root) {
  let gradle;
  try {
    gradle = fs.readFileSync(path.join(root, 'android/app/build.gradle'), 'utf8');
  } catch {
    return null;
  }
  return gradle.match(/^\s*applicationId\s+['"]([^'"]+)['"]/m)?.[1] ?? null;
}

/**
 * Every multi-line object in a project file by id, as its `isa` and its body
 * text. Objects sit two tabs in and close on a line of their own, and an added
 * target's objects can carry their `name` before `isa`, so neither is assumed
 * to come first.
 */
function pbxObjects(text) {
  const objects = new Map();
  const pattern = /^\t\t(\w+)(?: \/\*[^\n]*?\*\/)? = \{\n([^]*?)^\t\t\};/gm;
  for (const [, id, body] of text.matchAll(pattern)) {
    const isa = body.match(/^\t\t\tisa = (\w+);/m)?.[1];
    if (isa) objects.set(id, { isa, body });
  }
  return objects;
}

const setting = (body, key) =>
  body
    .match(new RegExp(`^\\s*${key} = (?:"([^"]*)"|([^;\\s]+))(?: /\\*[^\\n]*?\\*/)?;`, 'm'))
    ?.slice(1)
    .find(Boolean);

/**
 * The bundle identifier of the application target in a project file, or null
 * when it has none or its configurations disagree. The widget and push
 * extensions are targets of their own, with the app's identifier plus a
 * suffix, so only the target whose product is an application is read.
 */
function pbxAppBundleId(text) {
  const objects = pbxObjects(text);
  const found = new Set();
  for (const { isa, body } of objects.values()) {
    if (isa !== 'PBXNativeTarget') continue;
    if (setting(body, 'productType') !== 'com.apple.product-type.application') continue;
    const list = objects.get(setting(body, 'buildConfigurationList'));
    const configurations = list?.body.match(/buildConfigurations = \(([^)]*)\)/)?.[1] ?? '';
    for (const [, id] of configurations.matchAll(/(\w+)(?: \/\*[^\n]*?\*\/)?,/g)) {
      const value = setting(objects.get(id)?.body ?? '', 'PRODUCT_BUNDLE_IDENTIFIER');
      found.add(value ?? null);
    }
  }
  return found.size === 1 ? [...found][0] : null;
}

/**
 * The bundle identifier a generated iOS project builds, or null when there is
 * no project, or more than one, as a generation over another identity's tree
 * leaves behind.
 */
function iosBundleId(root) {
  let projects;
  try {
    projects = fs
      .readdirSync(path.join(root, 'ios'))
      .filter((name) => name.endsWith('.xcodeproj') && name !== 'Pods.xcodeproj');
  } catch {
    return null;
  }
  if (projects.length !== 1) return null;
  try {
    return pbxAppBundleId(
      fs.readFileSync(path.join(root, 'ios', projects[0], 'project.pbxproj'), 'utf8')
    );
  } catch {
    return null;
  }
}

module.exports = {
  IDENTITIES,
  IdentityError,
  androidAppId,
  iosBundleId,
  pbxAppBundleId,
  selected,
};

if (require.main === module) {
  try {
    const [field] = process.argv.slice(2);
    const identity = selected(process.env);
    if (!Object.hasOwn(identity, field ?? '')) {
      throw new IdentityError(`usage: app-identity.js ${Object.keys(identity).join('|')}`);
    }
    console.log(identity[field]);
  } catch (error) {
    if (!(error instanceof IdentityError)) throw error;
    console.error(`app-identity: ${error.message}`);
    process.exit(2);
  }
}
