/**
 * Scenario: an Android rider wants to start a ride without opening the app and
 * hunting for a sport, from a long press on the icon or from the shade with the
 * phone locked.
 *
 * Expected behaviour: the snapshot carries the recent sports as one pre-localised
 * list, `recordShortcuts`, which is the single source for every record surface.
 * The single-sport surfaces (the widgets, the iOS control) take its head, the
 * launcher publishes it as dynamic shortcuts, and the Quick Settings tile draws
 * its head's label. Natives hold no i18n and no sport-to-label map, exactly as
 * they hold none for anything else the snapshot carries.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  composeSnapshot,
  WIDGET_SNAPSHOT_SCHEMA_VERSION,
  type RawWidgetData,
} from '@/features/home/lib/widgetSnapshot';

const projectRoot = path.join(__dirname, '../..');
const readFile = (rel: string) => fs.readFileSync(path.join(projectRoot, rel), 'utf8');

const MODULE_KT = readFile(
  'modules/veloq-widget/android/src/main/java/com/veloq/widget/VeloqWidgetModule.kt'
);
const TILE_KT = readFile('widget/android/java/RecordTileService.kt');
const SNAPSHOT_KT = readFile('widget/android/java/WidgetSnapshot.kt');
const plugin = require('@/../src/plugins/with-android-widget.js');

function raw(overrides: Partial<RawWidgetData> = {}): RawWidgetData {
  return {
    sparklines: null,
    summary: null,
    latest: null,
    locale: 'en-AU',
    isMetric: true,
    nowSeconds: 1_700_000_000,
    ...overrides,
  };
}

describe('the snapshot carries the recent sports as one pre-localised list', () => {
  it('is schema 6, because the single field became a list', () => {
    expect(WIDGET_SNAPSHOT_SCHEMA_VERSION).toBe(6);
  });

  it('labels each sport from the translations the app already has', () => {
    const snap = composeSnapshot(
      raw({
        recentRecordingTypes: ['Ride', 'OpenWaterSwim'],
        translate: (k) => (k === 'activityTypes.Ride' ? 'Vélo' : k),
      })
    );
    expect(snap.recordShortcuts).toEqual([
      { type: 'Ride', label: 'Vélo', url: 'veloq://recording/Ride' },
      { type: 'OpenWaterSwim', label: 'OpenWaterSwim', url: 'veloq://recording/OpenWaterSwim' },
    ]);
  });

  it('caps the list at what a launcher will show', () => {
    const snap = composeSnapshot(
      raw({ recentRecordingTypes: ['Ride', 'Run', 'Swim', 'Hike', 'Row'] })
    );
    expect(snap.recordShortcuts).toHaveLength(3);
    expect(snap.recordShortcuts.map((s) => s.type)).toEqual(['Ride', 'Run', 'Swim']);
  });

  it('drops blanks and duplicates, so no surface gets an empty path or a repeat', () => {
    const snap = composeSnapshot(raw({ recentRecordingTypes: ['Ride', '  ', 'Ride', ' Run '] }));
    expect(snap.recordShortcuts.map((s) => s.type)).toEqual(['Ride', 'Run']);
  });

  it('is empty before anything has been recorded, which is the fallback signal', () => {
    expect(composeSnapshot(raw()).recordShortcuts).toEqual([]);
  });
});

describe('the launcher shortcuts are published from that one list', () => {
  it('the module exposes the call and sets them as dynamic shortcuts', () => {
    expect(MODULE_KT).toContain('Function("publishRecordShortcuts")');
    expect(MODULE_KT).toContain('ShortcutManagerCompat.setDynamicShortcuts');
  });

  it('takes each URL from the snapshot rather than composing a second one', () => {
    expect(MODULE_KT).toContain('Intent.ACTION_VIEW');
    expect(MODULE_KT).toContain('entry["url"]');
    expect(MODULE_KT).not.toContain('veloq://');
  });

  it('clears them when nothing has been recorded, rather than leaving a stale sport', () => {
    expect(MODULE_KT).toContain('removeAllDynamicShortcuts');
  });
});

describe('the Quick Settings tile is the same intent behind the shade', () => {
  it('is a TileService that opens the record deep link', () => {
    expect(TILE_KT).toContain('class RecordTileService : TileService()');
    expect(TILE_KT).toContain('WidgetRenderer.recordUrl(snap)');
    expect(TILE_KT).not.toContain('veloq://');
  });

  it('imports the app package it resolves R against, which only a build catches', () => {
    // A generated widget source names its package as __PKG__, so a bare `R` does
    // not resolve there and Jest cannot see it. This assertion is the cheap half
    // of the check that cost a full assembleDebug to find.
    for (const source of ['RecordTileService.kt', 'VeloqRecordWidgetProvider.kt']) {
      const text = fs.readFileSync(path.join(projectRoot, 'widget/android/java', source), 'utf8');
      if (!/\bR\.(string|drawable|layout|bool|color|id)\./.test(text)) continue;
      expect(text).toContain('import __PKG__.R');
    }
  });

  it('takes its label from the snapshot, so the tile holds no i18n', () => {
    expect(TILE_KT).toContain('qsTile');
    expect(TILE_KT).toContain('recordShortcuts');
    expect(SNAPSHOT_KT).toContain('val recordShortcuts: List<RecordShortcut>');
    expect(SNAPSHOT_KT).toContain('val lastRecordingType: String?');
  });

  it('rides the one record gate, so the flag going off takes the tile with it', () => {
    const app: { service?: { $: Record<string, string> }[] } = {
      service: [{ $: { 'android:name': '.widget.RecordTileService' } }],
    };
    plugin.applyServices(app, false);
    expect((app.service ?? []).map((s) => s.$['android:name'])).not.toContain(
      '.widget.RecordTileService'
    );

    const on: { service?: { $: Record<string, string> }[] } = {};
    plugin.applyServices(on, true);
    const tile = (on.service ?? []).find(
      (s) => s.$['android:name'] === '.widget.RecordTileService'
    );
    expect(tile).toBeDefined();
    expect(tile!.$['android:permission']).toBe('android.permission.BIND_QUICK_SETTINGS_TILE');
    expect(tile!.$['android:exported']).toBe('true');
  });

  it('is copied into the app package like every other widget source', () => {
    const platformProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'quick-start-'));
    plugin.writeWidgetSources(projectRoot, platformProjectRoot, 'com.veloq.app');
    const tile = path.join(
      platformProjectRoot,
      'app/src/main/java/com/veloq/app/widget/RecordTileService.kt'
    );
    expect(fs.existsSync(tile)).toBe(true);
    expect(fs.readFileSync(tile, 'utf8')).toContain('package com.veloq.app.widget');
  });
});
