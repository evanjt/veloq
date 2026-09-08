/**
 * Scenario: `INCLUDE_RECORD_WIDGET` decides whether the Quick-Record widget is in
 * the gallery, and it is now on.
 *
 * Expected behaviour: that one flag gates every widget route into recording, on
 * both platforms. The standalone widget is not the only one, the Dashboard
 * widget's large layout carries a record button over the same deep link, so the
 * flag has to reach the layout as well as the manifest. On iOS the same flag
 * decides whether `VeloqRecordWidget` is in either bundle, which is what puts a
 * widget in the gallery. Both states are asserted, because the flag is the only
 * thing between a shipped widget and no widget at all, and every resource it
 * pulls in has to exist for the on state to build.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const plugin = require('@/../src/plugins/with-android-widget.js');
const iosPlugin = require('@/../src/plugins/with-ios-widget.js');
const flags = require('@/../src/plugins/widgetFlags.js');

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

function runIosBundles(): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-gate-ios-'));
  iosPlugin.writeWidgetBundles(dest);
  return fs.readFileSync(path.join(dest, 'WidgetBundles.swift'), 'utf8');
}

describe('the record gate is one flag', () => {
  it('is on: Q13 asked for it off until recording was wired end to end, and it is', () => {
    expect(flags.INCLUDE_RECORD_WIDGET).toBe(true);
  });

  it('is the same flag both plugins read', () => {
    expect(plugin.INCLUDE_RECORD_WIDGET).toBe(flags.INCLUDE_RECORD_WIDGET);
    expect(iosPlugin.INCLUDE_RECORD_WIDGET).toBe(flags.INCLUDE_RECORD_WIDGET);
  });

  it('registers the standalone receiver while it is on', () => {
    const app: { receiver: { $: Record<string, string> }[] } = { receiver: [] };
    plugin.applyReceivers(app);
    const names = app.receiver.map((r) => r.$['android:name']);
    expect(names).toContain('.widget.VeloqRecordWidgetProvider');
    expect(names).toContain('.widget.VeloqWidgetProvider');
  });

  it('gives that receiver an info resource that exists, or the manifest will not build', () => {
    const app: { receiver: { $: Record<string, string> }[] } = { receiver: [] };
    plugin.applyReceivers(app);
    const record = app.receiver.find(
      (r) => r.$['android:name'] === '.widget.VeloqRecordWidgetProvider'
    );
    expect(record).toBeDefined();
    const root = runSourcesMod();
    for (const file of ['res/xml/widget_record_info.xml', 'res/layout/widget_record.xml']) {
      expect(fs.existsSync(path.join(root, 'app/src/main', file))).toBe(true);
    }
    expect(
      fs.existsSync(
        path.join(root, 'app/src/main/java/com/veloq/app/widget/VeloqRecordWidgetProvider.kt')
      )
    ).toBe(true);
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

  it('puts the record widget in both iOS bundles, which is what the flag being on means', () => {
    const swift = runIosBundles();
    expect(swift).toContain('struct VeloqWidgets: WidgetBundle');
    expect(swift).toContain('struct VeloqWidgetsConfigurable: WidgetBundle');
    expect(swift).toContain('VeloqLatestActivityWidget()');
    const configurable = swift.indexOf('struct VeloqWidgetsConfigurable');
    expect(swift.indexOf('VeloqRecordWidget()')).toBeGreaterThan(-1);
    expect(swift.indexOf('VeloqRecordWidget()', configurable)).toBeGreaterThan(configurable);
  });

  it('takes it back out of both bundles when the flag is off, so the gate still works', () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'widget-gate-ios-off-'));
    iosPlugin.writeWidgetBundles(dest, false);
    const swift = fs.readFileSync(path.join(dest, 'WidgetBundles.swift'), 'utf8');
    expect(swift).not.toContain('VeloqRecordWidget()');
    expect(swift).toContain('VeloqLatestActivityWidget()');
  });

  it('compiles the generated bundles, which exist only under ios/', () => {
    const projectRoot = path.join(__dirname, '../..');
    const compiled = iosPlugin.widgetSwiftFiles(projectRoot);

    expect(compiled).toContain(iosPlugin.BUNDLES_FILE);
    expect(compiled).toContain('VeloqWidget.swift');
    // The tracked tree is where the list is read from and the generated file is
    // not in it, so a list taken from disk alone leaves `VeloqWidgetLauncher`
    // calling `main()` on two types the target never compiled.
    const tracked = fs
      .readdirSync(path.join(projectRoot, 'widget/ios/VeloqWidget'))
      .filter((f) => f.endsWith('.swift'));
    expect(tracked).not.toContain(iosPlugin.BUNDLES_FILE);
    expect(compiled.filter((f: string) => f === iosPlugin.BUNDLES_FILE)).toHaveLength(1);
  });

  it('declares the bundles once, generated rather than tracked, so they cannot drift', () => {
    const tracked = fs.readFileSync(
      path.join(__dirname, '../../widget/ios/VeloqWidget/VeloqWidget.swift'),
      'utf8'
    );
    expect(tracked).toContain('struct VeloqRecordWidget: Widget');
    expect(tracked).not.toContain(': WidgetBundle');
  });
});
