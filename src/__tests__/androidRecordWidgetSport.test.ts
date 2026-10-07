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

const plugin = require('@/../src/plugins/with-android-widget.js');

function activities(include?: boolean): { $: Record<string, string> }[] {
  const app: { activity: { $: Record<string, string> }[] } = { activity: [] };
  plugin.applyActivities(app, include);
  return app.activity;
}

describe('the Android Record widget is configured per instance', () => {
  it('registers that activity, and takes it back out with the flag', () => {
    const on = activities(true);
    const record = on.find((a) => a.$['android:name'] === '.widget.RecordWidgetConfigureActivity');
    expect(record).toBeDefined();
    expect(activities(false)).toHaveLength(0);
  });
});
