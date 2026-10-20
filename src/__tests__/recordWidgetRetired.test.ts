/**
 * Scenario: the Summary widget carries the record button from Medium up, so the
 * standalone Record widget is retired on both platforms. A phone upgrading from
 * a build that shipped it still has its receiver, its picker and its resources
 * in an `android/` tree that an incremental prebuild only adds to.
 *
 * Expected behaviour: no Record widget is declared on either platform, and a
 * prebuild over a tree that carries one takes it out, since a receiver naming a
 * class no longer compiled crashes the launcher and a resource naming a string
 * no longer written fails the build. The other record surfaces stay: the Quick
 * Settings tile on Android, the Control and the Live Activity on iOS.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const plugin = require('@/../src/plugins/with-android-widget.js');
const iosPlugin = require('@/../src/plugins/with-ios-widget.js');

const projectRoot = path.join(__dirname, '../..');

type Entry = { $: Record<string, string> };

const RECORD_RECEIVER = '.widget.VeloqRecordWidgetProvider';
const RECORD_PICKER = '.widget.RecordWidgetConfigureActivity';

describe('the Record widget is declared on neither platform', () => {
  it('registers no Record receiver, and removes one an earlier prebuild left', () => {
    const app: { receiver: Entry[] } = { receiver: [{ $: { 'android:name': RECORD_RECEIVER } }] };
    plugin.applyReceivers(app);
    const names = app.receiver.map((r) => r.$['android:name']);
    expect(names).not.toContain(RECORD_RECEIVER);
    expect(names).toContain('.widget.VeloqWidgetProvider');
  });

  it('registers no Record picker, and removes one an earlier prebuild left', () => {
    const app: { activity: Entry[] } = { activity: [{ $: { 'android:name': RECORD_PICKER } }] };
    plugin.applyActivities(app);
    const names = app.activity.map((a) => a.$['android:name']);
    expect(names).not.toContain(RECORD_PICKER);
    expect(names).toContain('.widget.SummaryWidgetConfigureActivity');
  });

  it('keeps the Quick Settings tile', () => {
    const app: { service: Entry[] } = { service: [] };
    plugin.applyServices(app);
    expect(app.service.map((s) => s.$['android:name'])).toContain('.widget.RecordTileService');
  });

  it('writes no Record widget sources, and clears those an earlier prebuild wrote', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'record-retired-'));
    try {
      const main = path.join(root, 'app/src/main');
      const stale = [
        'res/xml/widget_record_info.xml',
        'res/layout/widget_record.xml',
        'res/layout/widget_record_configure.xml',
        'res/drawable/widget_record_background.xml',
        'java/com/veloq/app/widget/VeloqRecordWidgetProvider.kt',
      ];
      for (const file of stale) {
        fs.mkdirSync(path.dirname(path.join(main, file)), { recursive: true });
        fs.writeFileSync(path.join(main, file), '');
      }
      plugin.writeWidgetSources(projectRoot, root, 'com.veloq.app');
      for (const file of stale) {
        expect([file, fs.existsSync(path.join(main, file))]).toEqual([file, false]);
      }
      expect(fs.existsSync(path.join(main, 'res/xml/veloq_widget_info.xml'))).toBe(true);
      expect(fs.existsSync(path.join(main, 'res/drawable/widget_record_glyph.xml'))).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('puts no Record widget in either iOS bundle, and keeps the Control and the Live Activity', () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'record-retired-ios-'));
    try {
      iosPlugin.writeWidgetBundles(dest);
      const swift = fs.readFileSync(path.join(dest, iosPlugin.BUNDLES_FILE), 'utf8');
      expect(swift).not.toMatch(/RecordWidget\(\)/);
      for (const half of swift.split('struct VeloqWidgetsConfigurable')) {
        expect(half).toMatch(/Veloq(Configurable)?Widget\(\)/);
        expect(half).toContain('VeloqRecordControl()');
        expect(half).toContain('VeloqRecordingLiveActivity()');
      }
    } finally {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  });
});
