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

const projectRoot = path.join(__dirname, '../..');
const widgetDir = path.join(projectRoot, 'widget/ios/VeloqWidget');

function source(file: string): string {
  return fs.readFileSync(path.join(widgetDir, file), 'utf8');
}

function bundles(): string {
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'record-sport-'));
  iosPlugin.writeWidgetBundles(dest);
  return fs.readFileSync(path.join(dest, 'WidgetBundles.swift'), 'utf8');
}

describe('the Record widget takes a sport on iOS 17 and up', () => {
  const intent = () => source('WidgetRecordIntent.swift');

  it('configures the widget with an intent rather than a static configuration', () => {
    expect(intent()).toContain('struct SelectRecordSportIntent: WidgetConfigurationIntent');
    expect(intent()).toContain('AppIntentConfiguration(');
    expect(intent()).toMatch(/@Parameter\(title: "Sport"\)[\s\S]*?var sport: RecordSportEntity\?/);
  });

  it('offers the snapshot’s own sport names, so no sport list is written in Swift', () => {
    const swift = intent();
    expect(swift).toContain('struct RecordSportQuery: EntityQuery');
    expect(swift).toContain('func suggestedEntities()');
    expect(swift).toContain('recordShortcuts');
    expect(swift).not.toMatch(/:\s*AppEnum\b/);
  });

  it('identifies a sport by the link the app composed, so two instances differ', () => {
    const swift = intent();
    // The url is the identity as well as the destination: one instance keeps
    // the ride's link and another the swim's, from the one snapshot.
    expect(swift).toMatch(/RecordSportEntity\(id: \$0\.url, label: \$0\.label\)/);
    expect(swift).toContain('RecordDeepLink.url(for: $0.id)');
  });

  it('still opens its own sport after that sport leaves the recent four', () => {
    const swift = intent();
    // entities(for:) is the rehydration, and it answers for an identifier the
    // snapshot no longer lists rather than dropping it.
    expect(swift).toContain('func entities(for identifiers: [String])');
    expect(swift).toMatch(
      /\?\? RecordSportEntity\(id: id, label: [A-Za-z.]*sportName\(from: id\)\)/
    );
    expect(swift).toContain('lastPathComponent');
  });

  it('reads the uncapped list, because the picker is not a launcher long press', () => {
    expect(source('WidgetSnapshotModel.swift')).toMatch(
      /let recordShortcuts: \[WidgetRecordShortcut\]\?/
    );
  });

  it('falls back to the last sport recorded when nothing is configured', () => {
    expect(intent()).toContain('?? RecordDeepLink.url(for: WidgetSnapshotStore.load())');
  });

  it('keeps the kind, so a widget placed on iOS 16 survives the upgrade', () => {
    expect(intent()).toContain('let kind = "VeloqRecordWidget"');
    expect(source('VeloqWidget.swift')).toContain('let kind = "VeloqRecordWidget"');
  });

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
