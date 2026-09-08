/**
 * Scenario: the Live Activity contract has to compile into two targets, and the
 * card only appears if the extension declares it.
 * Expected behaviour: the plugin copies the shared Swift into the bridge module,
 * names the Live Activity in every widget bundle, and opts the app in.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  LIVE_ACTIVITY_SHARED_FILES,
  applyWidgetBuildSettings,
  copySharedLiveActivitySources,
  writeWidgetBundles,
} from '@/../src/plugins/with-ios-widget';

function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'veloq-widget-'));
}

describe('shared Live Activity sources', () => {
  it('copies the contract into the bridge module, so both targets compile one file', () => {
    const root = tmp();
    const from = path.join(root, 'widget', 'ios', 'VeloqWidget');
    const to = path.join(root, 'modules', 'veloq-live-activity', 'ios');
    fs.mkdirSync(from, { recursive: true });
    for (const name of LIVE_ACTIVITY_SHARED_FILES) {
      fs.writeFileSync(path.join(from, name), `// ${name}\n`);
    }
    fs.writeFileSync(path.join(from, 'RecordingLiveActivity.swift'), '// views\n');

    copySharedLiveActivitySources(from, to);

    expect(fs.readdirSync(to).sort()).toEqual([...LIVE_ACTIVITY_SHARED_FILES].sort());
  });

  it('leaves the extension-only views behind, they cannot compile in the app', () => {
    expect(LIVE_ACTIVITY_SHARED_FILES).not.toContain('RecordingLiveActivity.swift');
  });
});

describe('widget bundles', () => {
  it('names the Live Activity in both bundles, or the card never registers', () => {
    const dir = tmp();
    writeWidgetBundles(dir, false);
    const swift = fs.readFileSync(path.join(dir, 'WidgetBundles.swift'), 'utf8');

    expect(swift.match(/VeloqRecordingLiveActivity\(\)/g)).toHaveLength(2);
    expect(swift).toContain('if #available(iOS 16.2, *)');
  });
});

/**
 * Scenario: `apple.ccacheEnabled` makes the pod install route every clang call
 * through a wrapper it addresses as `$(REACT_NATIVE_PATH)/scripts/xcode/...`,
 * and it writes that over the whole project. REACT_NATIVE_PATH is reached
 * through PODS_ROOT, which only a pod target carries, so the extension gets
 * `/../../node_modules/...` and the build stops at "unable to spawn process".
 * Expected behaviour: the extension names react-native from its own SRCROOT.
 */
describe('widget build settings', () => {
  it('resolves react-native without PODS_ROOT, which the extension never has', () => {
    const settings: Record<string, string> = {};

    applyWidgetBuildSettings(settings, '0.4.0', '29');

    expect(settings.REACT_NATIVE_PATH).toBe('"$(SRCROOT)/../node_modules/react-native"');
    expect(settings.REACT_NATIVE_PATH).not.toContain('PODS_ROOT');
  });

  it('carries the version and build number the extension is stamped with', () => {
    const settings: Record<string, string> = {};

    applyWidgetBuildSettings(settings, '0.4.0', '29');

    expect(settings.MARKETING_VERSION).toBe('"0.4.0"');
    expect(settings.CURRENT_PROJECT_VERSION).toBe('"29"');
  });
});
