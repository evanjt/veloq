// The commit a build was made from, in the one form everything reads.
//
// `app.config.js` records it into `extra.buildCommit`, expo-constants writes
// that into `assets/app.config` on every native build, the settings footer
// shows it and `scripts/install-apk.sh` compares it against HEAD. A trailing
// `+` means the tree carried uncommitted changes when the build was made, so
// the stamp names the commit it started from and proves nothing beyond it:
// two different builds off one dirty tree carry the same stamp.

const { execFileSync } = require('child_process');

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
}

/**
 * The stamp, or an empty string outside a checkout: a build made from a source
 * archive or a CI export has no commit to name and must still build.
 */
function buildStamp(cwd = process.cwd()) {
  try {
    const sha = git(['rev-parse', '--short', 'HEAD'], cwd);
    // Untracked files are not what makes a build differ from its commit, and
    // counting them marks every tree with a scratch file dirty.
    const dirty = git(['status', '--porcelain', '--untracked-files=no'], cwd) !== '';
    return dirty ? `${sha}+` : sha;
  } catch {
    return '';
  }
}

module.exports = { buildStamp };
