const path = require('node:path');

const {
  copySharedLiveActivitySources,
  LIVE_ACTIVITY_SHARED_FILES,
} = require('../src/plugins/with-ios-widget');

// The bridge pod compiles these, and they are gitignored, so nothing but this
// copy puts them on disk. The plugin does it too, but only while `expo prebuild`
// runs, and the iOS job skips prebuild whenever the native project came from the
// cache. That leaves the copy outside everything the cache holds.
const WIDGET_DIR = path.join('widget', 'ios', 'VeloqWidget');
const MODULE_DIR = path.join('modules', 'veloq-live-activity', 'ios');

function syncLiveActivitySources(root = process.cwd()) {
  copySharedLiveActivitySources(path.join(root, WIDGET_DIR), path.join(root, MODULE_DIR));
}

module.exports = { syncLiveActivitySources, LIVE_ACTIVITY_SHARED_FILES, WIDGET_DIR, MODULE_DIR };
if (require.main === module) syncLiveActivitySources(process.cwd());
