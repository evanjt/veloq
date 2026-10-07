// Every suite that built a fixture with `mkdtemp` left it behind unless it
// remembered to remove it, and over weeks that filled /tmp to its last inode
// and failed every gate on the machine. The cleanup is owned here instead of
// by each suite: the directories a test file creates are removed when it ends.
const { rmSync } = require('node:fs');

const MARK = Symbol.for('veloq.tempDirTracker');

/**
 * Wraps `mkdtemp` and `mkdtempSync` on `fsModule` so each directory they make
 * is remembered, and returns the function that removes what this file made.
 * Installed once per module object: the module is shared by every test file in
 * a worker, so a second install returns the first tracker's own list.
 */
function installTempDirTracker(fsModule) {
  if (fsModule[MARK]) return fsModule[MARK];
  const made = new Set();
  const sync = fsModule.mkdtempSync;
  const callback = fsModule.mkdtemp;
  fsModule.mkdtempSync = function trackedMkdtempSync(...args) {
    const dir = sync.apply(this, args);
    made.add(dir);
    return dir;
  };
  if (callback) {
    fsModule.mkdtemp = function trackedMkdtemp(...args) {
      const done = args[args.length - 1];
      if (typeof done !== 'function') return callback.apply(this, args);
      args[args.length - 1] = (err, dir) => {
        if (!err) made.add(dir);
        done(err, dir);
      };
      return callback.apply(this, args);
    };
  }
  const tracker = {
    removeAll() {
      const dirs = [...made];
      made.clear();
      for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
      return dirs;
    },
  };
  fsModule[MARK] = tracker;
  return tracker;
}

module.exports = { installTempDirTracker };
