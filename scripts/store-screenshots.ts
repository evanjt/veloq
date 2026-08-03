#!/usr/bin/env npx tsx
/**
 * Store screenshot compositor: captioned device composites at exact store
 * sizes, rendered from HTML templates with headless Chromium, flattened to
 * JPEG with ImageMagick. Ported from the proven traintime board.py.
 *
 * Usage:
 *   npx tsx scripts/store-screenshots.ts [options] [locale ...]
 *
 *   --palette night|day   default night
 *   --target <t>          all|play|appstore|ipad|feature|web  default all
 *   --install             mirror existing renders into the fastlane trees
 *   --out <dir>           output root override; such runs never touch fastlane
 *   --raw-dir <dir>       raw capture root override (stand-in testing)
 *
 * Raw captures land in artifacts/store/raw/{android,ios,ipad}/ named
 * 01-feed.png .. 06-insights.png (see .maestro/store-capture.yaml). Play
 * composites use Android captures, App Store composites use iOS captures,
 * never crossed. Output goes to artifacts/store/, and --install mirrors it
 * into config/fastlane/, replacing whole per-locale sets because supply and
 * deliver clobber the store set on upload.
 *
 * Marketing type is bundled Inter (assets/store-fonts/, OFL). The app itself
 * uses system fonts; the divergence is deliberate, so renders are identical
 * on any host. Env: CHROMIUM overrides the browser binary.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { storeLayout, storePalettes, type StorePalette } from '@/shared/theme/storeTheme';

import { APPLE_LOCALE, MIRRORS } from './store-locales';

const ROOT = path.resolve(__dirname, '..');
const FONTS = path.join(ROOT, 'assets', 'store-fonts');
const FASTLANE = path.join(ROOT, 'config', 'fastlane');
// Assigned after CLI parsing; --out and VELOQ_STORE_DIR both override.
let STORE = path.join(ROOT, 'artifacts', 'store');
const CHROMIUM = process.env.CHROMIUM ?? 'chromium';
// ImageMagick 6 (GitHub ubuntu runners) has no `magick` binary; set
// MAGICK=convert there.
const MAGICK = process.env.MAGICK ?? 'magick';

// Exact store pixel sizes. Play phone is 9:16, clear of Play's 2:1 aspect cap
// and inside its featuring-eligibility bar. iPad is the 13" class, the only
// tablet size Apple requires; 12.9" auto-scales from it.
const SIZES = {
  play: { width: 1080, height: 1920 },
  appstore: { width: 1320, height: 2868 },
  ipad: { width: 2064, height: 2752 },
  feature: { width: 1024, height: 500 },
  web: { width: 720, height: 1584 },
};

const SHOT_STEMS = [
  '01-feed',
  '02-activity',
  '03-fitness',
  '04-map',
  '05-routes',
  '06-insights',
];
const IPAD_SHOTS = 3;

// Captions keyed by Play locale, pre-broken with \n (CSS white-space:
// pre-line). Subcaptions describe what is on screen: no absolutes, no speed
// promises, no coaching. intervals.icu is named once, on the first shot.
interface Caption {
  cap: string;
  sub: string;
}
const CAPTIONS: Record<string, { shots: Caption[]; tagline: string }> = {
  'en-AU': {
    shots: [
      { cap: 'Your activity\nhistory', sub: 'Synced from your intervals.icu account.' },
      { cap: 'Map and charts\non one timeline', sub: 'Drag the chart and the marker moves with it.' },
      { cap: 'Fitness, fatigue\nand form', sub: 'Charted from your training load, day by day.' },
      { cap: "Where you've\nbeen riding", sub: '3D terrain, with a heatmap over your rides.' },
      { cap: 'Routes you\nride again', sub: 'Spotted in your history, attempts side by side.' },
      { cap: 'A daily read on\nyour training', sub: 'Section bests, milestones, week against week.' },
    ],
    tagline: 'Training analysis for rides and runs.',
  },
  'it-IT': {
    shots: [
      { cap: 'Il tuo storico\nattività', sub: 'Sincronizzato dal tuo account intervals.icu.' },
      { cap: 'Mappa e grafici\nsu una timeline', sub: 'Trascina il grafico e il cursore si muove con te.' },
      { cap: 'Fitness, fatica\ne forma', sub: 'Tracciati dal tuo carico, giorno per giorno.' },
      { cap: 'Dove sei\nandato in bici', sub: 'Terreno 3D, con una heatmap sulle tue uscite.' },
      { cap: 'Percorsi che\nripeti', sub: 'Trovati nel tuo storico, tentativi affiancati.' },
      { cap: 'Una lettura al giorno\ndel tuo allenamento', sub: 'Record di sezione, traguardi, settimana su settimana.' },
    ],
    tagline: 'Analisi degli allenamenti per bici e corsa.',
  },
  'fr-FR': {
    shots: [
      { cap: "Votre historique\nd'activités", sub: 'Synchronisé depuis votre compte intervals.icu.' },
      { cap: 'Carte et graphiques\nsur une chronologie', sub: 'Faites glisser le graphique, le repère suit.' },
      { cap: 'Fitness, fatigue\net forme', sub: 'Tracés depuis votre charge, jour après jour.' },
      { cap: 'Où vous avez\nroulé', sub: 'Terrain 3D, avec une heatmap de vos sorties.' },
      { cap: 'Les routes que\nvous répétez', sub: "Repérées dans l'historique, tentatives côte à côte." },
      { cap: 'Une lecture par jour\nde votre entraînement', sub: 'Records de section, jalons, semaine contre semaine.' },
    ],
    tagline: "Analyse d'entraînement pour vélo et course.",
  },
  'es-ES': {
    shots: [
      { cap: 'Tu historial\nde actividades', sub: 'Sincronizado desde tu cuenta de intervals.icu.' },
      { cap: 'Mapa y gráficas\nen una línea temporal', sub: 'Arrastra la gráfica y el marcador se mueve contigo.' },
      { cap: 'Fitness, fatiga\ny forma', sub: 'Trazados desde tu carga, día a día.' },
      { cap: 'Por dónde\nhas rodado', sub: 'Terreno 3D, con un heatmap de tus salidas.' },
      { cap: 'Rutas que\nrepites', sub: 'Detectadas en tu historial, intentos lado a lado.' },
      { cap: 'Una lectura diaria\nde tu entrenamiento', sub: 'Récords de sección, hitos, semana contra semana.' },
    ],
    tagline: 'Análisis de entrenamiento para bici y carrera.',
  },
};

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

interface Dims {
  pad: number;
  cap: number;
  sub: number;
  rule: number;
  devW: number;
  devR: number;
  bezel: number;
  glow: number;
  headH: number;
}

function dims(width: number, tablet: boolean): Dims {
  const pad = Math.floor(width * storeLayout.padRatio);
  const cap = Math.floor(width * storeLayout.capRatio);
  const sub = Math.floor(cap * storeLayout.subRatio);
  return {
    pad,
    cap,
    sub,
    rule: Math.max(4, Math.floor(width / 270)),
    devW: Math.floor(width * (tablet ? storeLayout.deviceRatioTablet : storeLayout.deviceRatio)),
    devR: Math.floor(width * storeLayout.radiusRatio),
    bezel: Math.max(8, Math.floor(width / 108)),
    glow: Math.floor(width * storeLayout.glowRatio),
    // Two caption lines at line-height 1.04, the subcaption's 0.34em top
    // margin, then two subcaption lines at 1.2. Two of each is the worst case
    // any locale needs; reserving it keeps the rule at one height across the
    // whole set.
    headH: Math.round(2 * cap * 1.04 + cap * 0.34 + 2 * sub * 1.2),
  };
}

// Left offsets and width for the rule's travelling position mark, as CSS
// percents. The mark is one shot's share of the bar with breathing room, and
// the last one ends flush with the right edge.
function markPositions(count: number): { offsets: string[]; width: string } {
  const width = 81 / count;
  const step = (100 - width) / (count - 1);
  return {
    offsets: Array.from({ length: count }, (_, i) => `${(i * step).toPrecision(4)}%`),
    width: `${width.toPrecision(4)}%`,
  };
}

function makeCss(p: StorePalette): string {
  return `
  @font-face { font-family: 'Store'; src: url('file://${FONTS}/Inter-Bold.ttf'); font-weight: 700; }
  @font-face { font-family: 'StoreText'; src: url('file://${FONTS}/Inter-Regular.ttf'); font-weight: 400; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; }
  body {
    background: radial-gradient(140% 100% at 50% 0%, ${p.bg} 55%, ${p.edge} 100%);
    font-family: 'StoreText', sans-serif;
  }
  .canvas { width: 100%; height: 100%; display: flex; flex-direction: column; padding: var(--pad); }
  .caption {
    font-family: 'Store', sans-serif;
    font-weight: 700;
    font-size: var(--cap);
    line-height: 1.04;
    letter-spacing: 0.045em;
    text-transform: uppercase;
    color: ${p.cap};
    white-space: pre-line;
  }
  .sub {
    margin-top: calc(var(--cap) * 0.34);
    font-size: var(--sub);
    line-height: 1.2;
    font-weight: 400;
    color: ${p.sub};
    letter-spacing: 0.01em;
  }
  .head { height: var(--headh); }
  .rule {
    margin-top: calc(var(--cap) * 0.52);
    height: var(--rule);
    background: ${p.ruleBase};
    position: relative;
  }
  .rule::before {
    content: '';
    position: absolute; left: var(--mark, 0%); top: 0; bottom: 0;
    width: var(--markw, 27%);
    background: ${p.mark};
  }
  .stage { flex: 1; position: relative; margin-top: calc(var(--cap) * 0.62); }
  .device {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    top: 0;
    width: var(--devw);
    border-radius: var(--devr);
    padding: var(--bezel);
    background: linear-gradient(160deg, ${p.bezelStart}, ${p.bezelEnd} 40%);
    box-shadow: ${p.shadow};
  }
  .screen { display: block; width: 100%; border-radius: calc(var(--devr) - var(--bezel)); }
`;
}

function phoneHtml(
  p: StorePalette,
  d: Dims,
  mark: string,
  markW: string,
  caption: Caption,
  screen: string
): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
${makeCss(p)}
:root {
  --pad: ${d.pad}px; --cap: ${d.cap}px; --sub: ${d.sub}px; --rule: ${d.rule}px;
  --mark: ${mark}; --markw: ${markW}; --headh: ${d.headH}px;
  --devw: ${d.devW}px; --devr: ${d.devR}px; --bezel: ${d.bezel}px; --glow: ${d.glow}px;
}
</style></head>
<body>
  <div class="canvas">
    <div class="head">
      <div class="caption">${caption.cap}</div>
      <div class="sub">${caption.sub}</div>
    </div>
    <div class="rule"></div>
    <div class="stage">
      <div class="device"><img class="screen" src="file://${screen}"></div>
    </div>
  </div>
</body></html>
`;
}

function featureHtml(p: StorePalette, tagline: string, screen: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
${makeCss(p)}
:root { --pad: 0px; --cap: 86px; --sub: 30px; --rule: 5px; --glow: 70px; --markw: 27%; }
.canvas { flex-direction: row; align-items: center; padding: 0 64px; gap: 56px; }
.left { flex: 1; }
.wordmark {
  font-family: 'Store', sans-serif;
  font-weight: 700;
  font-size: 86px;
  letter-spacing: 0.03em;
  color: ${p.cap};
}
.wordmark span { color: ${p.mark}; }
.left .rule { margin: 26px 0 22px; }
.tagline { font-size: 31px; color: ${p.sub}; }
.right { height: 100%; position: relative; width: 300px; flex: none; }
.phone {
  position: absolute;
  width: 240px; left: 30px; top: 52px;
  border-radius: 30px;
  border: 8px solid ${p.bezelStart};
  box-shadow: ${p.shadow};
}
</style></head>
<body>
  <div class="canvas">
    <div class="left">
      <div class="wordmark">velo<span>q</span></div>
      <div class="rule"></div>
      <div class="tagline">${tagline}</div>
    </div>
    <div class="right"><img class="phone" src="file://${screen}"></div>
  </div>
</body></html>
`;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function render(html: string, width: number, height: number, outPng: string): void {
  fs.mkdirSync(path.dirname(outPng), { recursive: true });
  const page = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'store-')), 'page.html');
  fs.writeFileSync(page, html);
  try {
    execFileSync(CHROMIUM, [
      '--headless',
      '--disable-gpu',
      '--no-sandbox',
      '--force-device-scale-factor=1',
      '--hide-scrollbars',
      // Headless can screenshot before large file:// captures decode; give
      // the page a virtual-time budget so they land first.
      '--virtual-time-budget=3000',
      `--window-size=${width},${height}`,
      `--screenshot=${outPng}`,
      `file://${page}`,
    ]);
  } finally {
    fs.rmSync(path.dirname(page), { recursive: true, force: true });
  }
}

// Both stores reject alpha, and JPEG keeps a locale set small enough to
// commit: a 1320x2868 gradient-over-map PNG is 1.5-3 MB, the JPEG ~0.5 MB.
function toJpeg(png: string, dest: string, bg: string): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  execFileSync(MAGICK, [
    png,
    '-background',
    bg,
    '-alpha',
    'remove',
    '-alpha',
    'off',
    '-strip',
    '-quality',
    '90',
    dest,
  ]);
  console.log(`  ${path.relative(STORE, dest)}`);
}

// ---------------------------------------------------------------------------
// Shots
// ---------------------------------------------------------------------------

type Target = 'play' | 'appstore' | 'ipad' | 'feature' | 'web';

function rawDirFor(target: Target): string {
  const base = process.env.VELOQ_RAW_DIR ?? path.join(ROOT, 'artifacts', 'store', 'raw');
  if (target === 'appstore') return path.join(base, 'ios');
  if (target === 'ipad') return path.join(base, 'ipad');
  return path.join(base, 'android'); // play, feature, web
}

// Play gets Android captures, the App Store gets iOS captures. Throwing on an
// empty directory is deliberate: a wrong-platform set must never ship
// silently via fallback.
function shots(target: Target, count: number): string[] {
  const dir = rawDirFor(target);
  const files = SHOT_STEMS.slice(0, count).map((stem) => path.join(dir, `${stem}.png`));
  const missing = files.filter((f) => !fs.existsSync(f));
  if (missing.length > 0) {
    throw new Error(
      `Missing raw captures for ${target} in ${dir}:\n  ${missing
        .map((f) => path.basename(f))
        .join('\n  ')}\nRun the capture flow first (scripts/store-capture.sh).`
    );
  }
  return files;
}

function buildLocale(locale: string, palette: StorePalette, targets: Target[]): void {
  const strings = CAPTIONS[locale];
  if (!strings) throw new Error(`No captions for locale ${locale}`);

  for (const target of targets.filter((t) => t === 'play' || t === 'appstore' || t === 'ipad')) {
    const size = SIZES[target];
    const count = target === 'ipad' ? IPAD_SHOTS : SHOT_STEMS.length;
    const raws = shots(target, count);
    const { offsets, width: markW } = markPositions(count);
    const d = dims(size.width, target === 'ipad');
    console.log(`${locale} ${target}`);
    raws.forEach((raw, i) => {
      const html = phoneHtml(palette, d, offsets[i], markW, strings.shots[i], raw);
      const tmpPng = path.join(STORE, target, locale, `${String(i + 1).padStart(2, '0')}.png`);
      render(html, size.width, size.height, tmpPng);
      toJpeg(tmpPng, tmpPng.replace(/\.png$/, '.jpg'), palette.bg);
      fs.rmSync(tmpPng);
    });
  }

  if (targets.includes('feature')) {
    const raw = shots('feature', 1)[0];
    const html = featureHtml(palette, strings.tagline, raw);
    const tmpPng = path.join(STORE, 'feature', locale, 'featureGraphic.png');
    console.log(`${locale} feature`);
    render(html, SIZES.feature.width, SIZES.feature.height, tmpPng);
    toJpeg(tmpPng, tmpPng.replace(/\.png$/, '.jpg'), palette.bg);
    fs.rmSync(tmpPng);
  }
}

// ---------------------------------------------------------------------------
// Website
// ---------------------------------------------------------------------------

// docs/screenshots names that map onto store shots. 03-activity-3d, 04-charts
// and 08-performance have no store equivalent and keep their existing files.
const WEB_MAP: Record<string, string> = {
  '01-feed': '01-feed',
  '02-activity': '02-activity-map',
  '03-fitness': '05-fitness',
  '04-map': '06-regional-map',
  '05-routes': '07-routes',
};

function buildWeb(): void {
  const raws = shots('web', SHOT_STEMS.length);
  console.log('web');
  for (const raw of raws) {
    const stem = path.basename(raw, '.png');
    const dest = WEB_MAP[stem];
    if (!dest) continue;
    const out = path.join(ROOT, 'docs', 'screenshots', `${dest}.png`);
    execFileSync(MAGICK, [
      raw,
      '-resize',
      `${SIZES.web.width}x${SIZES.web.height}`,
      '-strip',
      out,
    ]);
    console.log(`  docs/screenshots/${dest}.png`);
  }
  syncSiteCopy();
}

// Replace content between store-copy markers in docs/index.html from the
// en-AU promotional text, so the site hero never drifts from the listings.
// The site is JS-localised via data-i18n; this syncs the English source only.
function syncSiteCopy(): void {
  const htmlPath = path.join(ROOT, 'docs', 'index.html');
  const hook = fs
    .readFileSync(path.join(FASTLANE, 'metadata', 'ios', 'en-AU', 'promotional_text.txt'), 'utf8')
    .trim();
  let html = fs.readFileSync(htmlPath, 'utf8');
  const marker = /(<!-- store-copy:hook -->)([\s\S]*?)(<!-- \/store-copy:hook -->)/;
  if (!marker.test(html)) {
    console.log('  docs/index.html has no store-copy markers, skipped');
    return;
  }
  html = html.replace(marker, `$1${hook}$3`);
  fs.writeFileSync(htmlPath, html);
  console.log('  docs/index.html hook synced');
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

function replaceDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function copySet(fromDir: string, toDir: string, rename?: (name: string) => string): void {
  for (const file of fs.readdirSync(fromDir).sort()) {
    if (!file.endsWith('.jpg')) continue;
    fs.copyFileSync(path.join(fromDir, file), path.join(toDir, rename ? rename(file) : file));
  }
}

// Whole per-locale sets are replaced, never merged: supply and deliver clobber
// the store set on upload, so the repo must be the single source of truth.
function install(locales: string[]): void {
  for (const locale of locales) {
    const targets = [locale, ...(MIRRORS[locale] ?? [])];

    const playSrc = path.join(STORE, 'play', locale);
    const featureSrc = path.join(STORE, 'feature', locale, 'featureGraphic.jpg');
    const appstoreSrc = path.join(STORE, 'appstore', locale);
    const ipadSrc = path.join(STORE, 'ipad', locale);

    for (const target of targets) {
      if (fs.existsSync(playSrc)) {
        const imagesDir = path.join(FASTLANE, 'metadata', 'android', target, 'images');
        const phoneDir = path.join(imagesDir, 'phoneScreenshots');
        replaceDir(phoneDir);
        copySet(playSrc, phoneDir);
        if (fs.existsSync(featureSrc)) {
          fs.mkdirSync(imagesDir, { recursive: true });
          fs.copyFileSync(featureSrc, path.join(imagesDir, 'featureGraphic.jpg'));
        }
        console.log(`installed play ${target}`);
      }
      if (fs.existsSync(appstoreSrc)) {
        const appleDir = path.join(FASTLANE, 'screenshots', APPLE_LOCALE[target] ?? target);
        replaceDir(appleDir);
        copySet(appstoreSrc, appleDir);
        if (fs.existsSync(ipadSrc)) {
          copySet(ipadSrc, appleDir, (name) => `ipad-${name}`);
        }
        console.log(`installed appstore ${APPLE_LOCALE[target] ?? target}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
function flagValue(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : undefined;
}

const paletteName = (flagValue('--palette') ?? 'night') as 'night' | 'day';
const targetArg = flagValue('--target') ?? 'all';
const outDir = flagValue('--out');
const rawDir = flagValue('--raw-dir');
const installOnly = args.includes('--install');
const locales = args.filter(
  (a, i) => !a.startsWith('--') && args[i - 1] !== '--palette' && args[i - 1] !== '--target' && args[i - 1] !== '--out' && args[i - 1] !== '--raw-dir'
);

if (process.env.VELOQ_STORE_DIR) STORE = process.env.VELOQ_STORE_DIR;
if (outDir) STORE = path.resolve(outDir);
if (rawDir) process.env.VELOQ_RAW_DIR = path.resolve(rawDir);

const palette = storePalettes[paletteName];
if (!palette) throw new Error(`Unknown palette ${paletteName}`);

const targets: Target[] =
  targetArg === 'all' ? ['play', 'appstore', 'ipad', 'feature'] : [targetArg as Target];
const buildLocales = locales.length > 0 ? locales : ['en-AU'];

if (installOnly) {
  if (outDir) throw new Error('--install always reads artifacts/store, not --out');
  install(buildLocales);
} else {
  if (targets.includes('web')) buildWeb();
  const composited = targets.filter((t) => t !== 'web');
  if (composited.length > 0) {
    for (const locale of buildLocales) buildLocale(locale, palette, composited);
  }
}
