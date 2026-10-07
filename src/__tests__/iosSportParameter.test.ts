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
  composeWidgetContext,
  RECORD_SHORTCUT_LIMIT,
  type WidgetContextInput,
} from '@/features/home/lib/widgetSnapshot';

const NO_DATES = {
  weekdays: [],
  monthDay: { parts: [], months: [] },
  monthDayYear: { parts: [], months: [] },
};

function raw(overrides: Partial<WidgetContextInput> = {}): WidgetContextInput {
  return { locale: 'en-AU', isMetric: true, dates: NO_DATES, ...overrides };
}

describe('the sport list a phrase can choose from comes from the snapshot', () => {
  it('carries every sport the athlete has recorded, not just what a launcher shows', () => {
    const context = composeWidgetContext(
      raw({ recentRecordingTypes: ['Ride', 'Run', 'Swim', 'Hike', 'Rowing'] })
    );
    expect(context.recordShortcuts.length).toBeGreaterThan(RECORD_SHORTCUT_LIMIT);
    expect(context.recordShortcuts.map((s) => s.type)).toEqual([
      'Ride',
      'Run',
      'Swim',
      'Hike',
      'Rowing',
    ]);
  });

  it('still hands the launcher only what it will show', () => {
    const context = composeWidgetContext(
      raw({ recentRecordingTypes: ['Ride', 'Run', 'Swim', 'Hike', 'Rowing'] })
    );
    expect(context.launcherShortcuts).toHaveLength(RECORD_SHORTCUT_LIMIT);
    expect(context.launcherShortcuts).toEqual(
      context.recordShortcuts.slice(0, RECORD_SHORTCUT_LIMIT)
    );
  });

  it('keeps the labels localised, because that is the whole point', () => {
    const context = composeWidgetContext(
      raw({
        recentRecordingTypes: ['Ride'],
        translate: (k) => (k === 'activityTypes.Ride' ? 'Vélo' : k),
      })
    );
    expect(context.recordShortcuts[0].label).toBe('Vélo');
  });
});
