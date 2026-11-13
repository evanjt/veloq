/**
 * Scenario: the iOS widget capture runs from a Swift package written out of the tracked widget
 * sources, on a Mac, where a missing file, a stray entry point or a leftover resource fails the
 * package's build rather than the capture, and only on the macOS runner.
 *
 * Expected behaviour: the package compiles every widget source the app's extension compiles,
 * with the bundles the plugin generates and without the extension's entry
 * point or any file a package cannot build, beside every widget test, the fixtures and the font
 * files the extension lists, so the captures draw the face the widgets draw.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const projectRoot = join(__dirname, '../../..');
const { widgetFontFiles, widgetSwiftFiles } = require(
  join(projectRoot, 'src/plugins/with-ios-widget.js')
);

let out: string;

beforeAll(() => {
  out = join(mkdtempSync(join(tmpdir(), 'widget-capture-package-')), 'WidgetCaptures');
  execFileSync('node', [
    join(projectRoot, 'scripts/write-widget-capture-package.mjs'),
    '--out',
    out,
  ]);
});

afterAll(() => {
  rmSync(join(out, '..'), { recursive: true, force: true });
});

it('compiles every source the extension compiles, and nothing a package cannot build', () => {
  const sources = readdirSync(join(out, 'Sources', 'VeloqWidget')).sort();
  // The bridge module's quick-action builder imports UIKit alone, and its test is a widget test.
  expect(sources).toEqual([...widgetSwiftFiles(projectRoot), 'RecordQuickActions.swift'].sort());
});

it('keeps the bundles and drops the entry point, which would be the test bundle one', () => {
  const sources = join(out, 'Sources', 'VeloqWidget');
  expect(readFileSync(join(sources, 'VeloqWidget.swift'), 'utf8')).not.toMatch(/^@main$/m);
  const bundles = readFileSync(join(sources, 'WidgetBundles.swift'), 'utf8');
  expect(bundles).toContain('struct VeloqWidgetsConfigurable');
});

it('carries every widget test and both fixtures beside the package manifest', () => {
  const tests = join(out, 'Tests', 'WidgetCaptureTests');
  const tracked = readdirSync(join(projectRoot, 'widget', 'ios', 'tests')).filter((name) =>
    name.endsWith('.swift')
  );
  expect(tracked).toContain('WidgetCaptureTests.swift');
  expect(readdirSync(tests).sort()).toEqual([...tracked, 'fixtures', 'fonts'].sort());
  expect(readdirSync(join(tests, 'fixtures')).sort()).toEqual([
    'demo.json',
    'empty.json',
    'long-text.json',
    'no-wellness.json',
  ]);
  expect(readFileSync(join(out, 'Package.swift'), 'utf8')).toContain(
    'resources: [.copy("fixtures"), .copy("fonts")]'
  );
});

it('carries every font file the extension lists, as the app bundles it', () => {
  const fonts = join(out, 'Tests', 'WidgetCaptureTests', 'fonts');
  const listed = widgetFontFiles(projectRoot);
  expect(listed.length).toBeGreaterThan(0);
  expect(readdirSync(fonts).sort()).toEqual([...listed].sort());
  for (const name of listed) {
    const copied = readFileSync(join(fonts, name));
    expect(copied.equals(readFileSync(join(projectRoot, 'assets', 'fonts', name)))).toBe(true);
  }
});
