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
