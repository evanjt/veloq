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

import path from 'path';

const iosPlugin = require('@/../src/plugins/with-ios-widget.js');

const projectRoot = path.join(__dirname, '../..');

describe('the record deep link is one rule, shared by both targets', () => {
  it('is compiled by the app target and the extension both', () => {
    expect(iosPlugin.SHARED_APP_FILES).toContain('RecordDeepLink.swift');
    expect(iosPlugin.SHARED_APP_FILES).toContain('VeloqAppShortcuts.swift');
    expect(iosPlugin.widgetSwiftFiles(projectRoot)).toContain('RecordDeepLink.swift');
  });
});
