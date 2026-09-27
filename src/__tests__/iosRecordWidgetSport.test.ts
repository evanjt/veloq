/**
 * Scenario: a rider whose Sunday ride follows a Tuesday swim places the Record
 * widget and it offers a swim, because one provider reads one snapshot field.
 *
 * Expected behaviour: on iOS 17 and up the Record widget is configurable. Long
 * press, Edit Widget, pick the sport, and that widget keeps it. The choices are
 * the snapshot's own pre-localised sport names, the way the App Shortcut's
 * parameter already takes them, rather than an English `AppEnum` compiled into
 * the extension. An unconfigured widget starts the last sport recorded, and the
 * kind is unchanged so a widget placed before the upgrade survives it.
 *
 * The case the identity has to survive: recents are capped at four, so a sport
 * a widget was configured with drops off the snapshot's list. AppIntents keeps
 * an entity by its identifier alone and re-resolves it through the query, so an
 * identifier that is the sport's own type would come back as nothing and that
 * widget would quietly start whatever was recorded last.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';

const iosPlugin = require('@/../src/plugins/with-ios-widget.js');

function bundles(): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'record-sport-'));
  iosPlugin.writeWidgetBundles(dest);
  return fs.readFileSync(path.join(dest, 'WidgetBundles.swift'), 'utf8');
}

describe('the Record widget takes a sport on iOS 17 and up', () => {
  it('is the record widget the iOS 17 bundle carries, and the static one is the 15/16 bundle’s', () => {
    const generated = bundles();
    const configurable = generated.indexOf('struct VeloqWidgetsConfigurable');
    expect(configurable).toBeGreaterThan(-1);
    const legacy = generated.slice(0, configurable);
    const modern = generated.slice(configurable);
    expect(legacy).toContain('VeloqRecordWidget()');
    expect(legacy).not.toContain('VeloqConfigurableRecordWidget()');
    expect(modern).toContain('VeloqConfigurableRecordWidget()');
    expect(modern).not.toMatch(/^\s*VeloqRecordWidget\(\)$/m);
  });

  it('drops both with the flag, because one record surface off is every record surface off', () => {
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'record-sport-off-'));
    iosPlugin.writeWidgetBundles(dest, false);
    const off = fs.readFileSync(path.join(dest, 'WidgetBundles.swift'), 'utf8');
    expect(off).not.toContain('VeloqRecordWidget()');
    expect(off).not.toContain('VeloqConfigurableRecordWidget()');
  });
});
