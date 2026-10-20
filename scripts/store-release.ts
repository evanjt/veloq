#!/usr/bin/env node
/**
 * What a release tag sends to Google Play and the App Store.
 *
 * The listings live in config/fastlane/metadata, Play's screenshot sets in
 * each locale's metadata/android/<locale>/images, and the App Store's in
 * config/fastlane/screenshots/<locale>, all of them written by
 * `npm run store:screenshots`. docs/screenshots is the website's and no store
 * reads it. Between the
 * previous release tag and this one, only the texts, images and screenshot
 * sets that changed are staged, so a store is never re-sent a listing it
 * already holds. Every locale's release notes are staged on every release,
 * because each version carries its own, and a missing, empty or oversized note,
 * or an App Store note left as the previous release shipped it, refuses the
 * release by name before anything is uploaded.
 *
 * supply and deliver both send only the files present under the path they are
 * given, so the staged tree is what decides what goes. A screenshot set is
 * staged whole: supply with sync_image_upload and deliver with
 * overwrite_screenshots then replace only the sets of the locales staged.
 *
 * Usage, run by node 24 or later, which strips the types:
 *   node scripts/store-release.ts plan --to <ref> [--from <ref>|none]
 *       [--version-code <n>] [--stage <dir>] [--github-output <file>]
 *   node scripts/store-release.ts drift --platform android|ios --live <dir>
 *
 * `plan` with no --from diffs against the highest release tag below the
 * version app.json names at --to. `drift` compares the listing texts a lane
 * downloaded from the store with the repository's, per locale.
 */

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ============================================================================
// Where each store file comes from
// ============================================================================

const METADATA_SOURCE = 'config/fastlane/metadata/';
const APP_STORE_SCREENSHOT_SOURCE = 'config/fastlane/screenshots/';

/** The App Store directories under metadata/ios that are not locales. */
const IOS_NON_LOCALE_DIRS = new Set([
  'review_information',
  'trade_representative_contact_information',
]);

/**
 * Google Play rejects a release note over 500 characters. The count is
 * characters, not bytes: a ja-JP note of 557 bytes is 187 characters.
 */
export const PLAY_CHANGELOG_MAX_CHARS = 500;

/**
 * Characters in a changelog as Play counts them: code points, so a kanji
 * is one and an emoji is one, and the trailing newline the file ends with
 * counts. Fastlane uploads the file's bytes and we cannot see whether
 * Play trims them, so the gate spends that character rather than risk a
 * rejected submission.
 */
export function changelogCharCount(text: string): number {
  return [...text].length;
}

/** A file in the repository at a ref: its path, a content id, and its text when read. */
export interface RepoFile {
  path: string;
  id: string;
  text?: string;
}

/** A file at its store path, with the repository file it installs from. */
export interface StoreFile {
  source: string;
  id: string;
  text?: string;
}

export interface StoreTree {
  /** By store path: `metadata/android/...`, `metadata/ios/...` or `screenshots/<locale>/...`. */
  files: Map<string, StoreFile>;
}

/** The store path a repository file installs as, or null for one no store reads. */
export function storePath(repoPath: string): string | null {
  if (repoPath.startsWith(APP_STORE_SCREENSHOT_SOURCE)) {
    const rest = repoPath.slice(APP_STORE_SCREENSHOT_SOURCE.length);
    const [locale, file, ...deeper] = rest.split('/');
    const image = file !== undefined && /\.(png|jpe?g)$/i.test(file);
    return locale && image && deeper.length === 0 ? `screenshots/${rest}` : null;
  }
  if (repoPath.startsWith(METADATA_SOURCE)) {
    const rest = repoPath.slice(METADATA_SOURCE.length);
    if (rest.startsWith('android/') || rest.startsWith('ios/')) return `metadata/${rest}`;
  }
  return null;
}

/** Every file a store reads, at its store path. */
export function storeTree(files: RepoFile[]): StoreTree {
  const tree: StoreTree = { files: new Map() };
  for (const file of files) {
    const at = storePath(file.path);
    if (at === null) continue;
    const entry: StoreFile = { source: file.path, id: file.id };
    if (file.text !== undefined) entry.text = file.text;
    tree.files.set(at, entry);
  }
  return tree;
}

// ============================================================================
// What changed
// ============================================================================

type Platform = 'android' | 'ios';
type Kind = 'text' | 'changelog' | 'image' | 'screenshots';

/** The unit a store path is uploaded in: one file, or a whole screenshot set. */
interface Unit {
  platform: Platform;
  locale: string | null;
  kind: Kind;
  key: string;
}

function unitOf(at: string): Unit | null {
  const [root = '', platform = '', third = '', fourth = '', fifth] = at.split('/');
  const depth = at.split('/').length;
  if (root === 'screenshots' && depth === 3) {
    return {
      platform: 'ios',
      locale: platform,
      kind: 'screenshots',
      key: `screenshots/${platform}/`,
    };
  }
  if (root !== 'metadata') return null;
  if (platform === 'android' && depth >= 4) {
    const locale = third;
    if (fourth === 'changelogs' && depth === 5) {
      return { platform: 'android', locale, kind: 'changelog', key: at };
    }
    if (fourth === 'images' && depth === 5) {
      return { platform: 'android', locale, kind: 'image', key: at };
    }
    if (fourth === 'images' && depth === 6) {
      const key = `metadata/android/${locale}/images/${fifth}/`;
      return { platform: 'android', locale, kind: 'screenshots', key };
    }
    if (depth === 4) return { platform: 'android', locale, kind: 'text', key: at };
    return null;
  }
  if (platform === 'ios') {
    if (depth === 3) return { platform: 'ios', locale: null, kind: 'text', key: at };
    if (depth === 4) {
      const locale = IOS_NON_LOCALE_DIRS.has(third) ? null : third;
      return { platform: 'ios', locale, kind: 'text', key: at };
    }
  }
  return null;
}

/** Each unit's files and their content, so two trees compare unit by unit. */
function unitsOf(tree: StoreTree): Map<string, { unit: Unit; files: Map<string, string> }> {
  const units = new Map<string, { unit: Unit; files: Map<string, string> }>();
  for (const [at, file] of tree.files) {
    const unit = unitOf(at);
    if (!unit) continue;
    const held = units.get(unit.key) ?? { unit, files: new Map<string, string>() };
    held.files.set(at, file.id);
    units.set(unit.key, held);
  }
  return units;
}

function sameFiles(a: Map<string, string>, b: Map<string, string>): boolean {
  return a.size === b.size && [...a].every(([at, id]) => b.get(at) === id);
}

export interface StorePlan {
  /** Why the release must not go, each naming the file. */
  refusals: string[];
  /** What no upload can do, for a person to do in the console. */
  notices: string[];
  /** The store paths to stage, sorted. */
  stage: string[];
  android: { metadata: boolean; images: boolean; screenshots: boolean };
  ios: { screenshots: boolean };
}

function localesOf(tree: StoreTree, platform: Platform): string[] {
  const locales = new Set<string>();
  for (const at of tree.files.keys()) {
    const unit = unitOf(at);
    if (unit?.platform === platform && unit.locale !== null && unit.kind === 'text') {
      locales.add(unit.locale);
    }
  }
  return [...locales].sort();
}

/**
 * The notes this version needs in every locale, and the refusal for each that
 * falls short. An App Store note carries no version in its name, so one whose
 * content is the previous release's was never rewritten and would ship that
 * release's text again.
 */
function releaseNotes(tree: StoreTree, previous: StoreTree | null, versionCode: number) {
  const notes: string[] = [];
  const refusals: string[] = [];
  const check = (at: string, cap: number | null, versioned: boolean) => {
    const file = tree.files.get(at);
    if (!file) {
      refusals.push(`${at} is missing`);
      return;
    }
    notes.push(at);
    const text = file.text ?? '';
    if (text.trim() === '') {
      refusals.push(`${at} is empty`);
    } else if (cap !== null && changelogCharCount(text) > cap) {
      refusals.push(`${at} is ${changelogCharCount(text)} characters, Play allows ${cap}`);
    } else if (!versioned && previous?.files.get(at)?.id === file.id) {
      refusals.push(
        `${at} is unchanged since the previous release, so the App Store would show its notes again`
      );
    }
  };
  for (const locale of localesOf(tree, 'android')) {
    check(
      `metadata/android/${locale}/changelogs/${versionCode}.txt`,
      PLAY_CHANGELOG_MAX_CHARS,
      true
    );
  }
  for (const locale of localesOf(tree, 'ios')) {
    check(`metadata/ios/${locale}/release_notes.txt`, null, false);
  }
  return { notes, refusals };
}

/** Whether a store path is a release note, the files whose text the plan reads. */
export function isReleaseNote(at: string, versionCode: number): boolean {
  return (
    /^metadata\/ios\/[^/]+\/release_notes\.txt$/.test(at) ||
    new RegExp(`^metadata/android/[^/]+/changelogs/${versionCode}\\.txt$`).test(at)
  );
}

/**
 * What to send between two release tags. `previous` null is the first
 * release, which sends everything. Older changelogs are never sent: Play
 * reads only this version code's.
 */
export function planStoreRelease(
  previous: StoreTree | null,
  current: StoreTree,
  versionCode: number
): StorePlan {
  const { notes, refusals } = releaseNotes(current, previous, versionCode);
  const plan: StorePlan = {
    refusals,
    notices: [],
    stage: [],
    android: { metadata: false, images: false, screenshots: false },
    ios: { screenshots: false },
  };
  const stage = new Set(notes);
  const before = previous ? unitsOf(previous) : new Map();
  const now = unitsOf(current);

  for (const [key, { unit, files }] of now) {
    if (unit.kind === 'changelog') continue;
    const was = before.get(key);
    if (was && sameFiles(was.files, files)) continue;
    for (const at of files.keys()) stage.add(at);
    if (unit.platform === 'android') {
      if (unit.kind === 'text') plan.android.metadata = true;
      if (unit.kind === 'image') plan.android.images = true;
      if (unit.kind === 'screenshots') plan.android.screenshots = true;
    } else if (unit.kind === 'screenshots') {
      plan.ios.screenshots = true;
    }
  }

  for (const [key, { unit }] of before) {
    if (unit.kind === 'changelog' || now.has(key)) continue;
    const what = unit.kind === 'screenshots' ? 'screenshot set' : unit.kind;
    plan.notices.push(
      `${key}: the ${what} was removed, and an upload cannot clear it from the ` +
        `${unit.platform === 'android' ? 'Play' : 'App Store'} listing; remove it in the console`
    );
  }

  plan.stage = [...stage].sort();
  return plan;
}

// ============================================================================
// Which tag came before
// ============================================================================

const RELEASE_TAG = /^(\d+)\.(\d+)\.(\d+)$/;

function versionParts(version: string): number[] | null {
  const match = RELEASE_TAG.exec(version);
  return match ? match.slice(1).map(Number) : null;
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * The highest release tag below `version`, by version rather than by name or
 * ancestry: `git describe` finds whatever tag is nearest, which here is a
 * history marker as often as a release.
 */
export function previousReleaseTag(tags: string[], version: string): string | null {
  const current = versionParts(version);
  if (!current) throw new Error(`${version} is not a release version`);
  let best: { tag: string; parts: number[] } | null = null;
  for (const tag of tags) {
    const parts = versionParts(tag);
    if (!parts || compareVersions(parts, current) >= 0) continue;
    if (!best || compareVersions(parts, best.parts) > 0) best = { tag, parts };
  }
  return best?.tag ?? null;
}

// ============================================================================
// Drift between the live listing and the repository
// ============================================================================

const LISTING_FIELDS: Record<Platform, string[]> = {
  android: ['title', 'short_description', 'full_description', 'video'],
  ios: [
    'name',
    'subtitle',
    'description',
    'keywords',
    'promotional_text',
    'marketing_url',
    'support_url',
    'privacy_url',
  ],
};

/**
 * One line per locale saying whether the live listing's texts match the
 * repository's. Both maps are keyed `<locale>/<field>.txt`. Release notes are
 * left out: each version carries its own, so the live one is never the next.
 */
export function listingDrift(
  platform: Platform,
  repo: Map<string, string>,
  live: Map<string, string>
): string[] {
  const norm = (text: string | undefined) => (text ?? '').replace(/\r\n/g, '\n').trim();
  const locales = (texts: Map<string, string>) =>
    new Set([...texts.keys()].map((key) => key.split('/')[0]));
  const inRepo = locales(repo);
  const inStore = locales(live);
  const lines: string[] = [];
  for (const locale of [...new Set([...inRepo, ...inStore])].sort()) {
    if (!inStore.has(locale)) {
      lines.push(`${platform} ${locale} differs: only in the repo`);
      continue;
    }
    if (!inRepo.has(locale)) {
      lines.push(`${platform} ${locale} differs: only in the store`);
      continue;
    }
    const differ = LISTING_FIELDS[platform]
      .map((field) => `${field}.txt`)
      .filter(
        (file) => norm(repo.get(`${locale}/${file}`)) !== norm(live.get(`${locale}/${file}`))
      );
    lines.push(
      differ.length === 0
        ? `${platform} ${locale} matches`
        : `${platform} ${locale} differs: ${differ.join(', ')}`
    );
  }
  return lines;
}

// ============================================================================
// CLI
// ============================================================================

function git(args: string[], encoding: 'utf8' | 'buffer' = 'utf8'): string | Buffer {
  return execFileSync('git', args, {
    encoding: encoding === 'utf8' ? 'utf8' : undefined,
    maxBuffer: 256 * 1024 * 1024,
  });
}

function filesAt(ref: string, versionCode: number): RepoFile[] {
  const out = git([
    'ls-tree',
    '-r',
    '-z',
    ref,
    '--',
    'config/fastlane/metadata',
    'config/fastlane/screenshots',
  ]);
  return String(out)
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      // `<mode> <type> <id>\t<path>`, the path last since it may hold spaces.
      const tab = line.indexOf('\t');
      const file = line.slice(tab + 1);
      const id = line.slice(0, tab).split(' ').pop() ?? '';
      const at = storePath(file);
      const entry: RepoFile = { path: file, id };
      if (at && isReleaseNote(at, versionCode)) {
        entry.text = String(git(['cat-file', 'blob', id]));
      }
      return entry;
    });
}

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

function appJsonAt(ref: string): { version: string; versionCode: number } {
  const app = JSON.parse(String(git(['show', `${ref}:app.json`])));
  return { version: app.expo.version, versionCode: app.expo.android.versionCode };
}

function readTexts(dir: string): Map<string, string> {
  const texts = new Map<string, string>();
  if (!fs.existsSync(dir)) return texts;
  for (const locale of fs.readdirSync(dir)) {
    const localeDir = path.join(dir, locale);
    if (!fs.statSync(localeDir).isDirectory() || IOS_NON_LOCALE_DIRS.has(locale)) continue;
    for (const file of fs.readdirSync(localeDir)) {
      if (file.endsWith('.txt')) {
        texts.set(`${locale}/${file}`, fs.readFileSync(path.join(localeDir, file), 'utf8'));
      }
    }
  }
  return texts;
}

function runPlan(args: string[]): number {
  const to = option(args, '--to') ?? 'HEAD';
  const app = appJsonAt(to);
  const versionCode = Number(option(args, '--version-code') ?? app.versionCode);
  let from = option(args, '--from');
  if (from === undefined) {
    from = previousReleaseTag(String(git(['tag', '--list'])).split('\n'), app.version) ?? 'none';
  }

  const current = storeTree(filesAt(to, versionCode));
  const previous = from === 'none' ? null : storeTree(filesAt(from, versionCode));
  const plan = planStoreRelease(previous, current, versionCode);

  console.log(`Store listings for ${app.version} (versionCode ${versionCode}), against ${from}:`);
  for (const at of plan.stage) console.log(`  send ${at}`);
  for (const notice of plan.notices) console.log(`::warning::${notice}`);
  if (plan.refusals.length > 0) {
    for (const refusal of plan.refusals) console.error(`::error::${refusal}`);
    return 1;
  }

  const stageDir = option(args, '--stage');
  if (stageDir) {
    fs.rmSync(stageDir, { recursive: true, force: true });
    for (const dir of ['metadata/android', 'metadata/ios', 'screenshots']) {
      fs.mkdirSync(path.join(stageDir, dir), { recursive: true });
    }
    for (const at of plan.stage) {
      const file = current.files.get(at);
      if (!file) continue;
      const dest = path.join(stageDir, at);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, git(['cat-file', 'blob', file.id], 'buffer'));
    }
  }

  const outputs = [
    `android_metadata=${plan.android.metadata}`,
    `android_images=${plan.android.images}`,
    `android_screenshots=${plan.android.screenshots}`,
    `ios_screenshots=${plan.ios.screenshots}`,
    `version_code=${versionCode}`,
  ];
  for (const line of outputs) console.log(line);
  const githubOutput = option(args, '--github-output');
  if (githubOutput) fs.appendFileSync(githubOutput, `${outputs.join('\n')}\n`);
  return 0;
}

function runDrift(args: string[]): number {
  const platform = option(args, '--platform');
  const live = option(args, '--live');
  if ((platform !== 'android' && platform !== 'ios') || !live) {
    console.error('drift needs --platform android|ios and --live <dir>');
    return 2;
  }
  const repoDir = path.join(scriptDir(), '..', 'config', 'fastlane', 'metadata', platform);
  const lines = listingDrift(platform, readTexts(repoDir), readTexts(live));
  for (const line of lines) console.log(line);
  return 0;
}

// The directory of this script, from the path node was given, so the file
// reads the same as an ES module under node and as CommonJS under Jest.
function scriptDir(): string {
  return path.dirname(path.resolve(process.argv[1] ?? '.'));
}

if (/store-release\.ts$/.test(process.argv[1] ?? '')) {
  const [command, ...rest] = process.argv.slice(2);
  const run = command === 'plan' ? runPlan : command === 'drift' ? runDrift : null;
  if (!run) {
    console.error('usage: store-release.ts plan|drift ...');
    process.exit(2);
  }
  process.exit(run(rest));
}
