// Copies the shared sprite and glyph directory into the pod directory as real
// files. CocoaPods lists a resource bundle's files itself and does not follow
// a symlink, so a link there gave a bundle with nothing in it. Android reads
// the shared directory directly through its asset source directory.
//
// Usage: node sync-basemap-assets.js
// The copy replaces whatever sits at the destination, and a missing source
// leaves the destination as it was.

const fs = require('node:fs');
const path = require('node:path');

const SOURCE = path.join(__dirname, '..', 'assets', 'basemap');
const DESTINATION = path.join(__dirname, '..', 'ios', 'BasemapAssets');

function syncBasemapAssets(source = SOURCE, destination = DESTINATION) {
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new Error(`basemap assets not found at ${source}`);
  }
  const staging = `${destination}.tmp`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.cpSync(source, staging, { recursive: true, dereference: true });
  fs.rmSync(destination, { recursive: true, force: true });
  fs.renameSync(staging, destination);
}

module.exports = { syncBasemapAssets };

if (require.main === module) {
  try {
    syncBasemapAssets();
  } catch (error) {
    console.error(`sync-basemap-assets: ${error.message}`);
    process.exit(1);
  }
}
