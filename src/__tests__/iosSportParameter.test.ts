/**
 * Scenario: an athlete who rides on Tuesday and swims on Thursday says "start a
 * swim on Veloq", or builds an automation that names the sport.
 *
 * Expected behaviour: the intent takes a sport, and the choices it offers are
 * the app's own pre-localised names rather than an English enum compiled into
 * the binary. The snapshot already carries `{type, label, url}` per sport, so
 * the options come from there at runtime and no sport list, and no display
 * name, is written a second time in Swift.
 */

import {
  composeSnapshot,
  RECORD_SHORTCUT_LIMIT,
  type RawWidgetData,
} from '@/features/home/lib/widgetSnapshot';

function raw(overrides: Partial<RawWidgetData> = {}): RawWidgetData {
  return {
    sparklines: null,
    summary: null,
    latest: null,
    locale: 'en-AU',
    isMetric: true,
    nowSeconds: 1_700_000_000,
    nowWallSeconds: 1_700_000_000,
    ...overrides,
  };
}

describe('the sport list a phrase can choose from comes from the snapshot', () => {
  it('carries every sport the athlete has recorded, not just what a launcher shows', () => {
    const snap = composeSnapshot(
      raw({ recentRecordingTypes: ['Ride', 'Run', 'Swim', 'Hike', 'Rowing'] })
    );
    expect(snap.recordShortcuts.length).toBeGreaterThan(RECORD_SHORTCUT_LIMIT);
    expect(snap.recordShortcuts.map((s) => s.type)).toEqual([
      'Ride',
      'Run',
      'Swim',
      'Hike',
      'Rowing',
    ]);
  });

  it('still hands the launcher only what it will show', () => {
    const snap = composeSnapshot(
      raw({ recentRecordingTypes: ['Ride', 'Run', 'Swim', 'Hike', 'Rowing'] })
    );
    expect(snap.launcherShortcuts).toHaveLength(RECORD_SHORTCUT_LIMIT);
    expect(snap.launcherShortcuts).toEqual(snap.recordShortcuts.slice(0, RECORD_SHORTCUT_LIMIT));
  });

  it('keeps the labels localised, because that is the whole point', () => {
    const snap = composeSnapshot(
      raw({
        recentRecordingTypes: ['Ride'],
        translate: (k) => (k === 'activityTypes.Ride' ? 'Vélo' : k),
      })
    );
    expect(snap.recordShortcuts[0].label).toBe('Vélo');
  });
});
