/**
 * Scenario: an athlete wants "when I leave home, start a ride" as a Shortcuts
 * automation, or just to say it to Siri. Neither is possible: the tree declares
 * no App Intent and no `AppShortcutsProvider`, so Veloq has no action at all.
 *
 * Expected behaviour: one App Intent in the app target, surfaced by an
 * `AppShortcutsProvider` so it appears in Siri, Spotlight and the Shortcuts
 * action list. It opens the same deep link every other record surface uses,
 * which is why the rule for composing that link is shared with the widget target
 * rather than written a second time.
 */

import fs from 'fs';
import path from 'path';

const iosPlugin = require('@/../src/plugins/with-ios-widget.js');

const projectRoot = path.join(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(projectRoot, rel), 'utf8');

const SHORTCUTS = read('widget/ios/shared/VeloqAppShortcuts.swift');
const LINK = read('widget/ios/shared/RecordDeepLink.swift');
const MODEL = read('widget/ios/VeloqWidget/WidgetSnapshotModel.swift');

describe('the record deep link is one rule, shared by both targets', () => {
  it('lives in its own file, so it can be compiled by both', () => {
    expect(LINK).toContain('enum RecordDeepLink');
    expect(LINK).toContain('static let picker');
    expect(LINK).toContain('static func url(for raw: String?) -> URL');
    // The whole Codable model does not have to come with it.
    expect(LINK).not.toContain('Codable');
  });

  it('is not written a second time in the widget model', () => {
    expect(MODEL).not.toContain('enum RecordDeepLink');
    expect(MODEL).toContain('extension RecordDeepLink');
    expect(MODEL.match(/veloq:\/\//g) ?? []).toHaveLength(0);
  });

  it('is compiled by the app target and the extension both', () => {
    expect(iosPlugin.SHARED_APP_FILES).toContain('RecordDeepLink.swift');
    expect(iosPlugin.SHARED_APP_FILES).toContain('VeloqAppShortcuts.swift');
    expect(iosPlugin.widgetSwiftFiles(projectRoot)).toContain('RecordDeepLink.swift');
  });
});

describe('the App Shortcut puts a Veloq action in Siri and Shortcuts', () => {
  it('declares a provider, which is what surfaces the phrase', () => {
    expect(SHORTCUTS).toContain('struct VeloqAppShortcuts: AppShortcutsProvider');
    expect(SHORTCUTS).toContain('AppShortcut(');
    expect(SHORTCUTS).toContain('phrases:');
    expect(SHORTCUTS).toContain('.applicationName');
  });

  it('opens the app at the started ride rather than at the picker', () => {
    expect(SHORTCUTS).toContain('struct StartRideIntent: AppIntent');
    expect(SHORTCUTS).toContain('openAppWhenRun');
    expect(SHORTCUTS).toContain('RecordDeepLink.url(for:');
    expect(SHORTCUTS).not.toContain('veloq://');
  });

  it('reads the sport from the same snapshot every other surface reads', () => {
    expect(SHORTCUTS).toContain('recordShortcuts');
    expect(SHORTCUTS).toContain('group.com.veloq.app');
  });
});

describe('the plugin puts the shared files where the app target compiles them', () => {
  it('copies them into the app group and names the app target', () => {
    const source = read('src/plugins/with-ios-widget.js');
    expect(source).toContain('SHARED_APP_FILES');
    expect(source).toContain('addMissingSourceFiles(proj, appTargetUuid');
  });
});
