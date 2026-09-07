/**
 * Scenario: the widget is stale exactly for the athlete whose app has not run,
 * and the numbers on it said nothing about how old they were. `generatedAt`
 * was in the payload on both platforms and rendered on neither.
 *
 * Expected behaviour: both renderers read the field and draw an age. The
 * drawing itself has no test harness on either platform, so what is held here
 * is that the binding exists and that the age is computed at render rather than
 * frozen into the payload, which is the mistake this could easily have been.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const kotlinModel = read('widget/android/java/WidgetSnapshot.kt');
const kotlinRenderer = read('widget/android/java/WidgetRenderer.kt');
const mediumLayout = read('widget/android/res/layout/widget_medium.xml');
const largeLayout = read('widget/android/res/layout/widget_large.xml');
const swiftModel = read('widget/ios/VeloqWidget/WidgetSnapshotModel.swift');
const swiftViews = read('widget/ios/VeloqWidget/WidgetViews.swift');
const payload = read('src/features/home/lib/widgetSnapshot.ts');

describe('the snapshot carries when it was written', () => {
  it('is in the payload, and in both native models', () => {
    expect(payload).toMatch(/generatedAt: raw\.nowSeconds/);
    expect(swiftModel).toMatch(/let generatedAt: Double/);
    expect(kotlinModel).toMatch(/val generatedAt: Long/);
    expect(kotlinModel).toMatch(/optLong\("generatedAt"/);
  });
});

describe('and both renderers draw it', () => {
  it('binds an age line on the Android medium and large widgets', () => {
    expect(mediumLayout).toMatch(/@\+id\/med_updated/);
    expect(largeLayout).toMatch(/@\+id\/large_updated/);
    expect(kotlinRenderer).toMatch(/bindUpdatedAt\(context, v, R\.id\.med_updated/);
    expect(kotlinRenderer).toMatch(/bindUpdatedAt\(context, v, R\.id\.large_updated/);
  });

  it('draws it on the iOS medium and large widgets', () => {
    expect(swiftViews).toMatch(/struct SnapshotAgeLine: View/);
    expect(swiftViews.match(/SnapshotAgeLine\(generatedAt:/g) ?? []).toHaveLength(2);
  });

  it('computes the age at render, so a stale snapshot cannot claim to be new', () => {
    // A label formatted when the snapshot was written would still read "just
    // now" a day later, which is the opposite of what this line is for.
    expect(kotlinRenderer).toMatch(/System\.currentTimeMillis\(\)/);
    expect(swiftViews).toMatch(/style: \.relative/);
    expect(payload).not.toMatch(/updatedLabel|generatedLabel/);
  });

  it('hides the line rather than dating a snapshot that predates the field', () => {
    expect(kotlinRenderer).toMatch(/if \(seconds <= 0L\)/);
    expect(swiftViews).toMatch(/seconds > 0/);
  });
});
