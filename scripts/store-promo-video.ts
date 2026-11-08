#!/usr/bin/env npx tsx
/**
 * The Play listing's promo video: about 30 s at 1920x1080 per language, cut
 * from the Android demo-mode captures with the store caption strings.
 *
 *   npx tsx scripts/store-promo-video.ts plan [urls.json]
 *       prints the cuts and the video.txt files the urls would write
 *   npx tsx scripts/store-promo-video.ts build [cut ...]
 *       builds artifacts/store/promo/<cut>.mp4 (git ignores artifacts/)
 *   npx tsx scripts/store-promo-video.ts link <urls.json>
 *       writes video.txt into each locale folder whose cut has a url
 *
 * urls.json maps a cut ("en" or a locale such as "de-DE") to its YouTube URL.
 * Uploading to YouTube is the owner's. Raw captures come from the same place
 * as the screenshots (`npm run store:screenshots`).
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { planPromoVideos, ENGLISH_CUT } from './lib/play-promo-video-plan';
import { CAPTIONS, rawCaptures } from './store-screenshots';
import { WEB_LOCALE } from './store-locales';
import { storePalette } from './store-theme';

const ROOT = path.resolve(__dirname, '..');
const METADATA = path.join(ROOT, 'config', 'fastlane', 'metadata', 'android');
const OUT = path.join(ROOT, 'artifacts', 'store', 'promo');
const FONTS = path.join(ROOT, 'assets', 'fonts');

const WIDTH = 1920;
const HEIGHT = 1080;
const SHOT_SECONDS = 6;
const FADE_SECONDS = 0.8;
const FPS = 30;
const PHONE_HEIGHT = 960;
// The strongest feature first, so the poster frame stands alone.
const SHOT_ORDER = ['03-map', '02-section', '04-activity', '01-feed', '06-insights', '05-fitness'];

function readUrls(file: string | undefined): Record<string, string> {
  return file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}

function plan(urls: Record<string, string>) {
  const locales = fs
    .readdirSync(METADATA, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);
  return planPromoVideos({ locales, urls });
}

function captionLocale(cut: string): string {
  return cut === ENGLISH_CUT ? WEB_LOCALE : cut;
}

function buildCut(cut: string, work: string): string {
  const locale = captionLocale(cut);
  const strings = CAPTIONS[locale];
  if (!strings) throw new Error(`No captions for ${locale}`);
  const rawRoot = process.env.VELOQ_RAW_DIR ?? path.join(ROOT, 'artifacts', 'store', 'raw');
  const stems = SHOT_ORDER;
  const files = rawCaptures('play', rawRoot, locale, Number.MAX_SAFE_INTEGER);
  const allStems = files.map((f) => path.basename(f, '.png'));
  const clips = stems.map((stem, i) => {
    const index = allStems.indexOf(stem);
    if (index < 0) throw new Error(`No capture ${stem} for ${locale}`);
    const caption = strings.shots[index];
    if (!caption) throw new Error(`${locale} has no caption for ${stem}`);
    const text = path.join(work, `${i}.txt`);
    fs.writeFileSync(text, caption.cap);
    const clip = path.join(work, `${i}.mp4`);
    const draw = (file: string, font: string, size: number, colour: string, y: number) =>
      `drawtext=fontfile=${path.join(FONTS, font)}:textfile=${file}:fontsize=${size}:fontcolor=${colour}:x=120:y=${y}:line_spacing=12`;
    const filter = [
      `color=c=${storePalette.stageTop}:s=${WIDTH}x${HEIGHT}:r=${FPS}[bg]`,
      `[0:v]scale=-2:${PHONE_HEIGHT}[phone]`,
      `[bg][phone]overlay=x=W-w-160:y=(H-h)/2:shortest=1[v]`,
      `[v]${draw(text, 'Manrope-Bold.ttf', 76, storePalette.cap, 380)}`,
    ].join(';');
    execFileSync(
      'ffmpeg',
      [
        ...[
          '-y',
          '-loglevel',
          'error',
          '-loop',
          '1',
          '-framerate',
          String(FPS),
          '-i',
          files[index],
        ],
        ...['-filter_complex', filter, '-t', String(SHOT_SECONDS), '-pix_fmt', 'yuv420p', clip],
      ],
      { stdio: 'inherit' }
    );
    return clip;
  });

  let chain = '0:v';
  const parts: string[] = [];
  clips.forEach((_, i) => {
    if (i === 0) return;
    const offset = i * (SHOT_SECONDS - FADE_SECONDS);
    parts.push(
      `[${chain}][${i}:v]xfade=transition=fade:duration=${FADE_SECONDS}:offset=${offset}[x${i}]`
    );
    chain = `x${i}`;
  });
  const out = path.join(OUT, `${cut}.mp4`);
  fs.mkdirSync(OUT, { recursive: true });
  execFileSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      ...clips.flatMap((c) => ['-i', c]),
      '-filter_complex',
      parts.join(';'),
      '-map',
      `[${chain}]`,
      '-an',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      out,
    ],
    { stdio: 'inherit' }
  );
  return out;
}

function main(args: string[]) {
  const [command, ...rest] = args;
  if (command === 'plan' || command === 'link') {
    const result = plan(readUrls(rest[0]));
    if (result.errors.length > 0) {
      console.error(result.errors.join('\n'));
      process.exit(1);
    }
    for (const c of result.cuts) console.log(`${c.cut}: ${c.locales.join(' ')}`);
    for (const f of result.videoFiles) {
      console.log(`video.txt ${f.locale} ${f.url}`);
      if (command === 'link') {
        fs.writeFileSync(path.join(METADATA, f.locale, 'video.txt'), `${f.url}\n`);
      }
    }
    return;
  }
  if (command === 'build') {
    const cuts = rest.length > 0 ? rest : plan({}).cuts.map((c) => c.cut);
    for (const cut of cuts) {
      const work = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-'));
      try {
        console.log(buildCut(cut, work));
      } finally {
        fs.rmSync(work, { recursive: true, force: true });
      }
    }
    return;
  }
  console.error(
    'usage: store-promo-video.ts plan [urls.json] | build [cut ...] | link <urls.json>'
  );
  process.exit(2);
}

if (/store-promo-video\.ts$/.test(process.argv[1] ?? '')) main(process.argv.slice(2));
