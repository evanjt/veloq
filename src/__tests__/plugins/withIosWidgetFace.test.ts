/**
 * Scenario: a widget extension draws a bundled font only when the font file is copied into the
 * extension's own bundle and its Info.plist lists the file under `UIAppFonts`; the app's copy is
 * out of reach. Asked for by a PostScript name it cannot find, iOS draws the system face, and
 * nothing says so.
 *
 * Expected behaviour: the extension's Info.plist lists every file of the widget face, the prebuild
 * copies each one beside it byte for byte and into the extension target's Resources phase, once
 * however many prebuilds run, and every PostScript name the widgets ask for is the one its file
 * carries.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import xcode from 'xcode';

import { widgetFace } from '@/shared/theme/widgetTheme';

const plist = require('@expo/plist').default;
const {
  configureWidgetProject,
  targetUuidByName,
  widgetFontFiles,
  writeWidgetFiles,
} = require('@/../src/plugins/with-ios-widget');

const projectRoot = path.join(__dirname, '../../..');
const TARGET = 'VeloqWidget';
const faceFiles: string[] = Object.values(widgetFace).map((face) => face.file);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function openFixture() {
  const file = path.join(tempDir('veloq-widget-face-'), 'project.pbxproj');
  fs.copyFileSync(path.join(__dirname, '__fixtures__', 'project.pbxproj'), file);
  return xcode.project(file).parseSync();
}

type Proj = ReturnType<typeof openFixture>;

/** Every file a target's Resources phase copies, a name once per entry. */
function copiedResources(proj: Proj, targetUuid: string): string[] {
  const phase = proj.pbxResourcesBuildPhaseObj(targetUuid) as unknown as
    { files: { comment: string }[] } | undefined;
  return (phase?.files ?? []).map((entry) => entry.comment.replace(/ in Resources$/, ''));
}

/** The PostScript name a TrueType file carries: name record 6 of its `name` table. */
function postScriptName(file: string): string {
  const font = fs.readFileSync(file);
  const tables = font.readUInt16BE(4);
  for (let i = 0; i < tables; i++) {
    const record = 12 + i * 16;
    if (font.toString('latin1', record, record + 4) !== 'name') continue;
    const table = font.readUInt32BE(record + 8);
    const count = font.readUInt16BE(table + 2);
    const strings = table + font.readUInt16BE(table + 4);
    for (let j = 0; j < count; j++) {
      const entry = table + 6 + j * 12;
      if (font.readUInt16BE(entry + 6) !== 6) continue;
      const platform = font.readUInt16BE(entry);
      const length = font.readUInt16BE(entry + 8);
      const start = strings + font.readUInt16BE(entry + 10);
      const bytes = font.subarray(start, start + length);
      // Platform 3 (Windows) stores the name in UTF-16BE, platform 1 (Mac) in single bytes.
      return platform === 3 ? bytes.swap16().toString('utf16le') : bytes.toString('latin1');
    }
  }
  throw new Error(`${file} has no PostScript name`);
}

describe('the iOS widget face', () => {
  const options = {
    projectName: 'VeloqDev',
    swiftFiles: ['VeloqWidget.swift'],
    bundleId: 'com.veloq.app.dev',
    version: '0.4.0',
    buildNumber: '7',
    fontFiles: widgetFontFiles(projectRoot),
  };

  it('is three files at 400, 600 and 700, each named by the PostScript name it carries', () => {
    expect(faceFiles).toEqual(['Manrope-Regular.ttf', 'Manrope-SemiBold.ttf', 'Manrope-Bold.ttf']);
    for (const face of Object.values(widgetFace)) {
      expect(postScriptName(path.join(projectRoot, 'assets', 'fonts', face.file))).toBe(
        face.postScript
      );
    }
  });

  it("lists every face file in the extension's UIAppFonts and copies each beside it", () => {
    const ios = tempDir('veloq-widget-face-files-');
    writeWidgetFiles(projectRoot, ios, 'App');
    const dest = path.join(ios, TARGET);
    const info = plist.parse(fs.readFileSync(path.join(dest, 'Info.plist'), 'utf8'));
    expect(info.UIAppFonts).toEqual(faceFiles);
    for (const file of faceFiles) {
      const written = fs.readFileSync(path.join(dest, file));
      expect(written.equals(fs.readFileSync(path.join(projectRoot, 'assets', 'fonts', file)))).toBe(
        true
      );
    }
  });

  it("keeps the face files through a second prebuild's prune of removed resources", () => {
    const ios = tempDir('veloq-widget-face-again-');
    writeWidgetFiles(projectRoot, ios, 'App');
    writeWidgetFiles(projectRoot, ios, 'App');
    for (const file of faceFiles) expect(fs.existsSync(path.join(ios, TARGET, file))).toBe(true);
  });

  it("copies every face file in the extension's Resources phase, once across two prebuilds", () => {
    const proj = openFixture();
    configureWidgetProject(proj, options);
    configureWidgetProject(proj, options);
    const copied = copiedResources(proj, targetUuidByName(proj, TARGET));
    for (const file of faceFiles) {
      expect(copied.filter((name) => name === file)).toHaveLength(1);
    }
    // The app's copy is the expo-font plugin's, so the widget's prebuild adds none there.
    const app = copiedResources(proj, targetUuidByName(proj, options.projectName));
    for (const file of faceFiles) expect(app).not.toContain(file);
  });

  it('references a face file as a file in the widget group, so Xcode copies it unchanged', () => {
    const proj = openFixture();
    configureWidgetProject(proj, options);
    const references = Object.values(proj.pbxFileReferenceSection()).filter(
      (ref): ref is { path: string; lastKnownFileType: string } =>
        typeof ref === 'object' && faceFiles.includes(String(ref.path).replace(/"/g, ''))
    );
    expect(references.map((ref) => String(ref.path).replace(/"/g, '')).sort()).toEqual(
      [...faceFiles].sort()
    );
    for (const ref of references) expect(ref.lastKnownFileType).toBe('file');
  });
});
