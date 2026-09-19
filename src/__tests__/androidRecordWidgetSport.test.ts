/**
 * Scenario: a rider whose Sunday ride follows a Tuesday swim places the Record
 * widget on an Android home screen and it offers a swim.
 *
 * Expected behaviour: one provider with a configure activity, not a provider per
 * sport. The sport set is whatever this athlete has recorded, so there is no
 * closed set to declare receivers for. Placing a widget still works with no
 * configuration, starting the last sport recorded, and the picker is reachable
 * afterwards. Two placed widgets hold two sports, which means per-widget state
 * and a PendingIntent request code per widget id: one shared request code makes
 * `FLAG_UPDATE_CURRENT` rewrite both instances to the same link.
 *
 * The chosen link is stored rather than the sport's type, because recents cap at
 * four and a configured sport drops off that list.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const plugin = require('@/../src/plugins/with-android-widget.js');

const projectRoot = path.join(__dirname, '../..');

function kotlin(file: string): string {
  return fs.readFileSync(path.join(projectRoot, 'widget/android/java', file), 'utf8');
}

function generated(): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'record-configure-'));
  plugin.writeWidgetSources(projectRoot, dest, 'com.veloq.app');
  return dest;
}

function activities(include?: boolean): { $: Record<string, string> }[] {
  const app: { activity: { $: Record<string, string> }[] } = { activity: [] };
  plugin.applyActivities(app, include);
  return app.activity;
}

describe('the Android Record widget is configured per instance', () => {
  it('points the provider at a configure activity, named in full', () => {
    const info = fs.readFileSync(
      path.join(generated(), 'app/src/main/res/xml/widget_record_info.xml'),
      'utf8'
    );
    expect(info).toContain(
      'android:configure="com.veloq.app.widget.RecordWidgetConfigureActivity"'
    );
    // Optional, so placing one starts the last sport recorded rather than
    // forcing the picker, and reconfigurable so the picker is reachable after.
    expect(info).toContain('android:widgetFeatures="reconfigurable|configuration_optional"');
  });

  it('registers that activity, and takes it back out with the flag', () => {
    const on = activities(true);
    const record = on.find((a) => a.$['android:name'] === '.widget.RecordWidgetConfigureActivity');
    expect(record).toBeDefined();
    expect(activities(false)).toHaveLength(0);
  });

  it('keeps the chosen link per widget id, not the sport’s type', () => {
    const choice = kotlin('RecordWidgetChoice.kt');
    expect(choice).toContain('fun url(context: Context, widgetId: Int): String?');
    expect(choice).toContain('fun put(context: Context, widgetId: Int, url: String)');
    expect(choice).toMatch(/"sport_url_\$widgetId"/);
  });

  it('forgets a widget’s sport when that widget is removed', () => {
    expect(kotlin('VeloqRecordWidgetProvider.kt')).toMatch(
      /override fun onDeleted\([\s\S]*?RecordWidgetChoice\.clear\(/
    );
  });

  it('falls back to the last sport recorded when an instance is unconfigured', () => {
    expect(kotlin('WidgetRenderer.kt')).toMatch(
      /fun recordUrl\(snap: WidgetSnapshot\?, configured: String\?\): String =\s*\n?\s*configured \?: recordUrl\(snap\)/
    );
  });

  it('gives each widget its own PendingIntent, so two instances hold two sports', () => {
    // FLAG_UPDATE_CURRENT rewrites the intent behind a request code, so a
    // shared one would point both widgets at whichever updated last.
    expect(kotlin('VeloqRecordWidgetProvider.kt')).toMatch(
      /recordIntent\(\s*context,\s*snap,\s*RecordWidgetChoice\.url\(context, id\),\s*id\s*\)/
    );
  });

  it('offers the snapshot’s own sport names, so no sport list is written in Kotlin', () => {
    const configure = kotlin('RecordWidgetConfigureActivity.kt');
    expect(configure).toContain('recordShortcuts');
    expect(configure).toContain('.label');
    expect(configure).toContain('RecordWidgetChoice.put(');
    expect(configure).toContain('EXTRA_APPWIDGET_ID');
    expect(configure).toContain('RESULT_OK');
  });
});
