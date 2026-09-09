/**
 * Scenario: the iOS build restores a cached `ios/` and skips `expo prebuild`.
 *
 * Expected behaviour: the Live Activity contract still reaches the bridge module.
 * The plugin writes those two files OUTSIDE `ios/`, into
 * `modules/veloq-live-activity/ios/`, and they are gitignored, so a prebuild the
 * cache made unnecessary leaves the pod compiling `Activity<VeloqRecordingAttributes>`
 * against a type nothing declares. The sync has to stand on its own.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const {
  syncLiveActivitySources,
  MODULE_DIR,
} = require('../../../scripts/sync-live-activity-sources');
const { LIVE_ACTIVITY_SHARED_FILES } = require('../../plugins/with-ios-widget');

const WIDGET_DIR = path.join('widget', 'ios', 'VeloqWidget');

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-live-activity-'));
  fs.mkdirSync(path.join(root, WIDGET_DIR), { recursive: true });
  for (const name of LIVE_ACTIVITY_SHARED_FILES) {
    fs.writeFileSync(path.join(root, WIDGET_DIR, name), `// ${name}`);
  }
  fs.writeFileSync(path.join(root, WIDGET_DIR, 'RecordingLiveActivity.swift'), '// WidgetKit');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

it('writes the shared contract into the bridge module with no native project present', () => {
  expect(fs.existsSync(path.join(root, 'ios'))).toBe(false);

  syncLiveActivitySources(root);

  for (const name of LIVE_ACTIVITY_SHARED_FILES) {
    expect(fs.readFileSync(path.join(root, MODULE_DIR, name), 'utf8')).toBe(`// ${name}`);
  }
});

it('leaves the extension-only views out of the module', () => {
  syncLiveActivitySources(root);
  expect(fs.existsSync(path.join(root, MODULE_DIR, 'RecordingLiveActivity.swift'))).toBe(false);
});

it('overwrites a stale copy a restored cache left behind', () => {
  const [first] = LIVE_ACTIVITY_SHARED_FILES;
  fs.mkdirSync(path.join(root, MODULE_DIR), { recursive: true });
  fs.writeFileSync(path.join(root, MODULE_DIR, first), '// stale');

  syncLiveActivitySources(root);

  expect(fs.readFileSync(path.join(root, MODULE_DIR, first), 'utf8')).toBe(`// ${first}`);
});

it('runs as a command from the repository root', () => {
  const script = path.join(__dirname, '..', '..', '..', 'scripts', 'sync-live-activity-sources.js');
  execFileSync('node', [script], { cwd: root });
  for (const name of LIVE_ACTIVITY_SHARED_FILES) {
    expect(fs.existsSync(path.join(root, MODULE_DIR, name))).toBe(true);
  }
});
