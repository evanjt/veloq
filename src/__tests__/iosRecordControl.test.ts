/**
 * Scenario: a rider stops at the top of the driveway with the phone locked and
 * wants to be recording without unlocking and hunting for the app.
 *
 * Expected behaviour: iOS 18's Control surfaces (Control Centre, the Lock Screen
 * and the Action Button) carry a Veloq Record button. It is a `ControlWidget` in
 * the WidgetKit extension that already exists, gated at iOS 18 inside the bundle
 * body the way the Live Activity is gated at 16.2, and its intent opens the same
 * deep link every other record surface uses, so one rule decides the sport.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const iosPlugin = require('@/../src/plugins/with-ios-widget.js');
const flags = require('@/../src/plugins/widgetFlags.js');

const projectRoot = path.join(__dirname, '../..');
const widgetDir = path.join(projectRoot, 'widget/ios/VeloqWidget');
const CONTROL = fs.readFileSync(path.join(widgetDir, 'RecordControl.swift'), 'utf8');
const MODEL = fs.readFileSync(path.join(widgetDir, 'WidgetSnapshotModel.swift'), 'utf8');

function bundles(includeRecord = flags.INCLUDE_RECORD_WIDGET): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-control-'));
  iosPlugin.writeWidgetBundles(dest, includeRecord);
  return fs.readFileSync(path.join(dest, iosPlugin.BUNDLES_FILE), 'utf8');
}

describe('the Record control is an iOS 18 ControlWidget in the existing extension', () => {
  it('declares a control, not a second target', () => {
    expect(CONTROL).toContain('@available(iOS 18.0, *)');
    expect(CONTROL).toContain('struct VeloqRecordControl: ControlWidget');
    expect(CONTROL).toContain('ControlWidgetButton(action:');
    expect(CONTROL).toContain('StaticControlConfiguration(kind:');
  });

  it('opens the deep link every other record surface uses, so one rule picks the sport', () => {
    expect(CONTROL).toContain('WidgetSnapshotStore.load()');
    expect(CONTROL).toContain('RecordDeepLink.url(for:');
    expect(CONTROL).toContain('OpenURLIntent(');
    // No second literal: the picker fallback lives in RecordDeepLink and nowhere else.
    expect(CONTROL).not.toContain('veloq://');
  });

  it('resolves to a URL rather than an optional, so no surface force-unwraps one', () => {
    expect(MODEL).toContain('static func url(for snapshot: WidgetSnapshot?) -> URL');
    expect(MODEL).not.toContain('-> URL?');
  });

  it('is in both generated bundles, gated at 18 the way the Live Activity is at 16.2', () => {
    const swift = bundles(true);
    const occurrences = swift.match(/VeloqRecordControl\(\)/g) ?? [];
    expect(occurrences).toHaveLength(2);
    for (const half of swift.split('struct VeloqWidgetsConfigurable')) {
      const at = half.indexOf('VeloqRecordControl()');
      expect(at).toBeGreaterThan(-1);
      expect(half.lastIndexOf('if #available(iOS 18.0, *)', at)).toBeGreaterThan(-1);
    }
  });

  it('leaves with the widget when the flag goes off: one gate, not two', () => {
    const swift = bundles(false);
    expect(swift).not.toContain('VeloqRecordControl()');
    expect(swift).not.toContain('VeloqRecordWidget()');
  });

  it('is compiled by the target, which reads the tracked directory', () => {
    expect(iosPlugin.widgetSwiftFiles(projectRoot)).toContain('RecordControl.swift');
  });
});
