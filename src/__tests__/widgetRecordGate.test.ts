/**
 * Scenario: the record surface is not ready to ship, so `INCLUDE_RECORD_WIDGET`
 * keeps the Quick-Record widget out of the gallery.
 *
 * Expected behaviour: that one flag gates every widget route into recording. The
 * standalone widget is not the only one, the Dashboard widget's large layout
 * carries a record button over the same deep link, so the flag has to reach the
 * layout as well as the manifest.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const plugin = require('@/../src/plugins/with-android-widget.js');

const KOTLIN = fs.readFileSync(
  path.join(__dirname, '../../widget/android/java/WidgetRenderer.kt'),
  'utf8'
);

function runSourcesMod(): string {
  const projectRoot = path.join(__dirname, '../..');
  const platformProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-gate-'));
  plugin.writeWidgetSources(projectRoot, platformProjectRoot, 'com.veloq.app');
  return platformProjectRoot;
}

describe('the record gate is one flag', () => {
  it('is off, which is the state Q13 asked for', () => {
    expect(plugin.INCLUDE_RECORD_WIDGET).toBe(false);
  });

  it('keeps the standalone receiver out of the manifest while it is off', () => {
    const app: { receiver: { $: Record<string, string> }[] } = {
      receiver: [{ $: { 'android:name': '.widget.VeloqRecordWidgetProvider' } }],
    };
    plugin.applyReceivers(app);
    const names = app.receiver.map((r) => r.$['android:name']);
    expect(names).not.toContain('.widget.VeloqRecordWidgetProvider');
    expect(names).toContain('.widget.VeloqWidgetProvider');
  });

  it('writes the flag into the widget resources so the layouts can read it', () => {
    const root = runSourcesMod();
    const flags = fs.readFileSync(
      path.join(root, 'app/src/main/res/values/widget_flags.xml'),
      'utf8'
    );
    expect(flags).toContain('name="widget_record_enabled"');
    expect(flags).toContain(`>${String(plugin.INCLUDE_RECORD_WIDGET)}<`);
  });

  it('gates the dashboard widget’s record button on that flag', () => {
    const gate = KOTLIN.indexOf('getBoolean(R.bool.widget_record_enabled)');
    expect(gate).toBeGreaterThan(-1);
    const attach = KOTLIN.indexOf('setOnClickPendingIntent(R.id.large_record');
    expect(attach).toBeGreaterThan(gate);
    expect(KOTLIN.indexOf('setOnClickPendingIntent(R.id.large_record', attach + 1)).toBe(-1);
    expect(KOTLIN).toContain('setViewVisibility(R.id.large_record, View.GONE)');
    expect(KOTLIN).toContain('setViewVisibility(R.id.large_record, View.VISIBLE)');
  });

  it('leaves the button hidden in the layout, so an ungated build never shows it', () => {
    const layout = fs.readFileSync(
      path.join(__dirname, '../../widget/android/res/layout/widget_large.xml'),
      'utf8'
    );
    const button = layout.slice(layout.indexOf('@+id/large_record'));
    expect(button.slice(0, button.indexOf('/>'))).toContain('android:visibility="gone"');
  });
});
