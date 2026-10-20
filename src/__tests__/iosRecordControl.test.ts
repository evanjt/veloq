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

const projectRoot = path.join(__dirname, '../..');

function bundles(): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-control-'));
  iosPlugin.writeWidgetBundles(dest);
  return fs.readFileSync(path.join(dest, iosPlugin.BUNDLES_FILE), 'utf8');
}

describe('the Record control is an iOS 18 ControlWidget in the existing extension', () => {
  it('is in both generated bundles, gated at 18 the way the Live Activity is at 16.2', () => {
    const swift = bundles();
    const occurrences = swift.match(/VeloqRecordControl\(\)/g) ?? [];
    expect(occurrences).toHaveLength(2);
    for (const half of swift.split('struct VeloqWidgetsConfigurable')) {
      const at = half.indexOf('VeloqRecordControl()');
      expect(at).toBeGreaterThan(-1);
      expect(half.lastIndexOf('if #available(iOS 18.0, *)', at)).toBeGreaterThan(-1);
    }
  });

  it('is compiled by the target, which reads the tracked directory', () => {
    expect(iosPlugin.widgetSwiftFiles(projectRoot)).toContain('RecordControl.swift');
  });
});

/**
 * Scenario: the athlete taps the Record control in Control Centre. Its intent
 * opens the app, and iOS refuses that from an extension: chronod logs
 * "openAppWhenRun is not supported in extensions" and nothing opens.
 *
 * Expected behaviour: the intent is compiled into the app as well as the
 * extension, so the system runs it in the app, and its source is the shared
 * directory both targets copy from.
 */
describe("the Record control's intent runs in the app", () => {
  const intentFile = 'StartRecordingIntent.swift';

  it('is compiled by the app target and the extension both', () => {
    expect(iosPlugin.SHARED_APP_FILES).toContain(intentFile);
    expect(iosPlugin.widgetSwiftFiles(projectRoot)).toContain(intentFile);
  });

  it('is written into both target directories by the prebuild', () => {
    const native = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-control-files-'));
    try {
      iosPlugin.writeWidgetFiles(projectRoot, native, 'VeloqDev', false);
      expect(fs.existsSync(path.join(native, 'VeloqDev', intentFile))).toBe(true);
      expect(fs.existsSync(path.join(native, 'VeloqWidget', intentFile))).toBe(true);
    } finally {
      fs.rmSync(native, { recursive: true, force: true });
    }
  });
});
