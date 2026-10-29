/**
 * Scenario: the capture flow, the compositor and the validator each need the
 * store's shot list. It is held once (scripts/store-shots.ts) and the flow, a
 * YAML file, can only be checked by reading it.
 *
 * Expected behaviour: every shot a store lists is either taken by the flow or
 * composed after it, the flow takes nothing no store lists, and each list fits
 * the store's own screenshot count.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import {
  CAPTURED_STEMS,
  SHOT_LAYOUTS,
  STORE_SHOTS,
  shotsFor,
  type StoreTarget,
} from '../../../scripts/store-shots';
import { APPSTORE_PHONE_SHOTS, PLAY_PHONE_SHOTS } from '../../../scripts/validate-store-metadata';

const ROOT = path.resolve(__dirname, '../../..');
const FLOW = fs.readFileSync(path.join(ROOT, '.maestro', 'store-capture.yaml'), 'utf8');
const TARGETS: StoreTarget[] = ['play', 'appstore', 'ipad'];

/** The stems the flow writes, in the order it takes them. */
function flowStems(): string[] {
  return [...FLOW.matchAll(/takeScreenshot:\s*"screenshots\/store-capture\/([^"]+)"/g)].map(
    (m) => m[1]
  );
}

describe('the store shot list', () => {
  it.each(TARGETS)('%s takes only shots the flow captures or composition produces', (target) => {
    const taken = new Set(flowStems());
    for (const shot of shotsFor(target)) {
      if (shot.source === 'captured') expect(taken).toContain(shot.stem);
    }
  });

  it('is taken by the flow in the order the list gives, and nothing else is', () => {
    expect(flowStems()).toEqual(CAPTURED_STEMS);
  });

  it('numbers its stems in order, each once', () => {
    const stems = STORE_SHOTS.map((s) => s.stem);
    expect(new Set(stems).size).toBe(stems.length);
    stems.forEach((stem, i) => {
      expect(stem.startsWith(String(i + 1).padStart(2, '0') + '-')).toBe(true);
    });
  });

  it('puts the map, section and strength shots in both phone stores', () => {
    for (const target of ['play', 'appstore'] as const) {
      const stems = shotsFor(target).map((s) => s.stem);
      expect(stems).toEqual(expect.arrayContaining(['02-map', '04-section', '07-strength']));
    }
  });

  it.each(['play', 'ipad'] as const)(
    'carries every captured stem the App Store does on %s',
    (target) => {
      const captured = (t: StoreTarget) =>
        shotsFor(t)
          .filter((s) => s.source === 'captured')
          .map((s) => s.stem);
      expect(captured(target)).toEqual(captured('appstore'));
    }
  );

  it('keeps the privacy panel to the App Store', () => {
    expect(shotsFor('play').map((s) => s.stem)).not.toContain('10-privacy');
    expect(shotsFor('appstore').map((s) => s.stem)).toContain('10-privacy');
  });

  it('fits the number of phone screenshots each store accepts', () => {
    expect(shotsFor('play').length).toBeGreaterThanOrEqual(PLAY_PHONE_SHOTS.min);
    expect(shotsFor('play').length).toBeLessThanOrEqual(PLAY_PHONE_SHOTS.max);
    expect(shotsFor('appstore').length).toBeGreaterThanOrEqual(APPSTORE_PHONE_SHOTS.min);
    expect(shotsFor('appstore').length).toBeLessThanOrEqual(APPSTORE_PHONE_SHOTS.max);
  });

  it('gives every shot a layout', () => {
    for (const shot of STORE_SHOTS) expect(SHOT_LAYOUTS[shot.stem]).toBeDefined();
  });
});

describe('the capture flow', () => {
  const at = (needle: string) => {
    const i = FLOW.indexOf(needle);
    expect(i).toBeGreaterThan(-1);
    return i;
  };

  it('sets the satellite style, 3D terrain and the heatmap before the map shot', () => {
    const shot = at('store-capture/02-map');
    expect(at('map-style-satellite')).toBeLessThan(shot);
    expect(at('terrain-3d-always')).toBeLessThan(shot);
    expect(at('map-toggle-heatmap')).toBeLessThan(shot);
  });

  it('closes the layers menu after the heatmap toggle and asserts it gone before the map shot', () => {
    const shot = at('store-capture/02-map');
    const heatmap = FLOW.lastIndexOf('map-toggle-heatmap', shot);
    const closed = FLOW.indexOf('helpers/close-map-layers.yaml', heatmap);
    expect(closed).toBeGreaterThan(heatmap);
    expect(FLOW.slice(closed, shot)).toMatch(/assertNotVisible:\s*\n\s+id: "map-layers-menu"/);
  });

  it('frames the map on the Valais ride rather than the library default', () => {
    expect(FLOW.slice(0, at('store-capture/02-map'))).toContain('veloq://map?activity=demo-test-0');
  });

  it('scrolls the feed to its top before the feed shot', () => {
    const feed = FLOW.slice(0, at('store-capture/01-feed'));
    expect(feed).toContain('home-activity-list');
  });

  it('waits for the Insights routes line to clear before the insights shot', () => {
    const before = FLOW.slice(0, at('store-capture/05-insights'));
    expect(before.lastIndexOf('routes-sync-banner')).toBeGreaterThan(
      before.indexOf('insights-panel')
    );
  });

  it('refuses every shot while the routes sync banner is up', () => {
    const steps = FLOW.split('\n- ').slice(1);
    const shots = steps.flatMap((step, i) => (step.startsWith('takeScreenshot:') ? [i] : []));
    expect(shots.length).toBeGreaterThan(0);
    for (const i of shots) {
      const guard = steps.slice(Math.max(0, i - 2), i).join('\n- ');
      expect(guard).toMatch(/assertNotVisible:\s*\n\s+id: "routes-sync-banner"/);
    }
  });

  it('keeps debug mode off while the activity shot is taken', () => {
    const activity = at('store-capture/03-activity');
    const debugOn = FLOW.indexOf(
      'checked: false\n    commands:\n      - tapOn:\n          id: "settings-debug-switch"'
    );
    expect(debugOn).toBeGreaterThan(activity);
  });

  it('switches debug mode off, and asserts it reads off, before the first shot', () => {
    const first = at('store-capture/01-feed');
    const off = FLOW.indexOf('checked: true');
    expect(off).toBeGreaterThan(-1);
    expect(off).toBeLessThan(first);
    const asserted = FLOW.indexOf('checked: false\n', off);
    expect(asserted).toBeGreaterThan(off);
    expect(asserted).toBeLessThan(first);
  });
});
