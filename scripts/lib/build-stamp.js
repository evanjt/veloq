// What a build was made from, in the one form everything reads.
//
// `app.config.js` records the stamp into `extra.buildCommit`, expo-constants
// writes that into `assets/app.config` on every native build, and the settings
// footer shows it. A clean tree's stamp is its commit. A dirty tree's is the
// commit, a `+` and the first eight characters of the hash of every build
// input as it sits in the working tree, so two builds off different edits to
// one commit carry different stamps.
//
// The stamp is configuration and says nothing about what was packaged. The
// build record (`scripts/lib/build-record.js`) ties the inputs to the bundle
// and the libraries an APK actually carries, and the installer checks that.

const { execFileSync } = require('child_process');
const path = require('path');

const { computeSourceHash, isBuildInput } = require('../compute-source-hash.js');

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/**
 * Whether `git status --porcelain -z` names a build input. A rename or copy
 * carries its origin as the next entry, which is skipped. An untracked file
 * counts only under a build directory, as the input hash counts it.
 */
function touchesBuildInput(status) {
  const entries = status.split('\0');
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    const file = entry.slice(3);
    if (/[RC]/.test(code)) i++;
    if (code === '??' && !file.includes('/')) continue;
    if (isBuildInput(file, 'all')) return true;
  }
  return false;
}

/**
 * The commit, whether any build input differs from it, the hash of the inputs
 * as the working tree holds them, and the stamp, or null outside a checkout.
 * Untracked files count only where a build reads them, so a scratch file at
 * the root leaves a tree clean.
 */
function sourceIdentity(cwd = process.cwd()) {
  let commit;
  let status;
  try {
    commit = git(['rev-parse', '--short', 'HEAD'], cwd).trim();
    status = git(['status', '--porcelain', '-z', '--untracked-files=all'], cwd);
  } catch {
    return null;
  }
  const dirty = touchesBuildInput(status);
  const inputs = computeSourceHash(path.resolve(cwd), 'all', { local: true });
  return { commit, dirty, inputs, stamp: dirty ? `${commit}+${inputs.slice(0, 8)}` : commit };
}

/**
 * The stamp, or an empty string outside a checkout: a build made from a source
 * archive or a CI export has no commit to name and must still build.
 */
function buildStamp(cwd = process.cwd()) {
  try {
    return sourceIdentity(cwd)?.stamp ?? '';
  } catch {
    return '';
  }
}

module.exports = { buildStamp, sourceIdentity };
