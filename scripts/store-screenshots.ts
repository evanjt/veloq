#!/usr/bin/env npx tsx
/**
 * Store screenshot compositor: captioned device composites at exact store
 * sizes, rendered from HTML templates with headless Chromium, flattened to
 * JPEG with ImageMagick.
 *
 * Usage:
 *   npx tsx scripts/store-screenshots.ts [options] [locale ...]
 *
 *   --palette night|day   default night
 *   --target <t>          all|play|appstore|ipad|feature|web  default all
 *   --install             mirror existing renders into the fastlane trees
 *   --site-copy           only rewrite the docs/index.html hero and feature grid from the listings
 *   --out <dir>           output root override; such runs never touch fastlane
 *   --raw-dir <dir>       raw capture root override (stand-in testing)
 *
 * A locale is a captured Play locale (scripts/store-locales.ts,
 * captureLocales), and no locale means every one. `npm run store:screenshots`
 * runs the captures, this with --palette day, and --install, in that order.
 *
 * Raw captures land in artifacts/store/raw/{android,ios,ipad}/<locale>/ named
 * 01-feed.png .. 06-insights.png (see .maestro/store-capture.yaml), and stay
 * out of git. Play composites use Android captures, App Store composites use
 * iOS captures, never crossed. Output goes to artifacts/store/, and --install
 * writes it into config/fastlane/, replacing whole per-locale sets because
 * supply and deliver clobber the store set on upload.
 *
 * Type is the app's bundled Manrope (assets/fonts/, OFL) and the feature
 * graphic draws the outlined logo, so renders are identical on any host.
 * Env: CHROMIUM overrides the browser binary.
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { storePalettes, type StorePalette } from '@/shared/theme/storeTheme';

import { syncSiteCopy, syncSiteGallery, type SiteShot } from './site-copy';
import { captureLocales, type CaptureLocale } from './store-locales';
import { dims, featureHtml, markPositions, phoneHtml, type Caption } from './store-templates';
import { readImageInfo } from './validate-store-metadata';

const ROOT = path.resolve(__dirname, '..');
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

// An App Store composite frames its raw capture at the slot's own size, so a
// capture from any other simulator is refused rather than scaled.
const RAW_SIZES: Partial<Record<Target, { width: number; height: number }>> = {
  appstore: SIZES.appstore,
  ipad: SIZES.ipad,
};

// The captured locale the website's screenshots come from, the one
// scripts/site-copy.ts reads the site's English text from.
const WEB_LOCALE = 'en-AU';

export const SHOT_STEMS = [
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
export const CAPTIONS: Record<string, { shots: Caption[]; tagline: string }> = {
  'en-US': {
    shots: [
      { cap: 'Your activity\nhistory', sub: 'Synced from your intervals.icu account.' },
      {
        cap: 'Map and charts\non one timeline',
        sub: 'Drag the chart and the marker moves with it.',
      },
      { cap: 'Fitness, fatigue\nand form', sub: 'Charted from your training load, day by day.' },
      { cap: "Where you've\nbeen riding", sub: '3D terrain, with a heatmap over your rides.' },
      { cap: 'Routes you\nride again', sub: 'Spotted in your history, attempts side by side.' },
      {
        cap: 'A daily read on\nyour training',
        sub: 'Section bests, milestones, week against week.',
      },
    ],
    tagline: 'Training analysis for rides and runs.',
  },
  'en-AU': {
    shots: [
      { cap: 'Your activity\nhistory', sub: 'Synced from your intervals.icu account.' },
      {
        cap: 'Map and charts\non one timeline',
        sub: 'Drag the chart and the marker moves with it.',
      },
      { cap: 'Fitness, fatigue\nand form', sub: 'Charted from your training load, day by day.' },
      { cap: "Where you've\nbeen riding", sub: '3D terrain, with a heatmap over your rides.' },
      { cap: 'Routes you\nride again', sub: 'Spotted in your history, attempts side by side.' },
      {
        cap: 'A daily read on\nyour training',
        sub: 'Section bests, milestones, week against week.',
      },
    ],
    tagline: 'Training analysis for rides and runs.',
  },
  'it-IT': {
    shots: [
      { cap: 'Il tuo storico\nattività', sub: 'Sincronizzato dal tuo account intervals.icu.' },
      {
        cap: 'Mappa e grafici\nsu una timeline',
        sub: 'Trascina il grafico e il cursore si muove con te.',
      },
      { cap: 'Fitness, fatica\ne forma', sub: 'Tracciati dal tuo carico, giorno per giorno.' },
      { cap: 'Dove sei\nandato in bici', sub: 'Terreno 3D, con una heatmap sulle tue uscite.' },
      { cap: 'Percorsi che\nripeti', sub: 'Trovati nel tuo storico, tentativi affiancati.' },
      {
        cap: 'Una lettura al giorno\ndel tuo allenamento',
        sub: 'Record di sezione, traguardi, settimana su settimana.',
      },
    ],
    tagline: 'Analisi degli allenamenti per bici e corsa.',
  },
  'fr-FR': {
    shots: [
      {
        cap: "Votre historique\nd'activités",
        sub: 'Synchronisé depuis votre compte intervals.icu.',
      },
      {
        cap: 'Carte et graphiques\nsur une chronologie',
        sub: 'Faites glisser le graphique, le repère suit.',
      },
      { cap: 'Fitness, fatigue\net forme', sub: 'Tracés depuis votre charge, jour après jour.' },
      { cap: 'Où vous avez\nroulé', sub: 'Terrain 3D, avec une heatmap de vos sorties.' },
      {
        cap: 'Les routes que\nvous répétez',
        sub: "Repérées dans l'historique, tentatives côte à côte.",
      },
      {
        cap: 'Une lecture par jour\nde votre entraînement',
        sub: 'Records de section, jalons, semaine contre semaine.',
      },
    ],
    tagline: "Analyse d'entraînement pour vélo et course.",
  },
  'es-ES': {
    shots: [
      {
        cap: 'Tu historial\nde actividades',
        sub: 'Sincronizado desde tu cuenta de intervals.icu.',
      },
      {
        cap: 'Mapa y gráficas\nen una línea temporal',
        sub: 'Arrastra la gráfica y el marcador se mueve contigo.',
      },
      { cap: 'Fitness, fatiga\ny forma', sub: 'Trazados desde tu carga, día a día.' },
      { cap: 'Por dónde\nhas rodado', sub: 'Terreno 3D, con un heatmap de tus salidas.' },
      { cap: 'Rutas que\nrepites', sub: 'Detectadas en tu historial, intentos lado a lado.' },
      {
        cap: 'Una lectura diaria\nde tu entrenamiento',
        sub: 'Récords de sección, hitos, semana contra semana.',
      },
    ],
    tagline: 'Análisis de entrenamiento para bici y carrera.',
  },
  'es-419': {
    shots: [
      {
        cap: 'Tu historial\nde actividades',
        sub: 'Sincronizado desde tu cuenta de intervals.icu.',
      },
      {
        cap: 'Mapa y gráficas\nen una línea de tiempo',
        sub: 'Arrastra la gráfica y el marcador se mueve con ella.',
      },
      {
        cap: 'Condición, fatiga\ny forma',
        sub: 'Graficadas desde tu carga, día a día.',
      },
      { cap: 'Por dónde\nhas pedaleado', sub: 'Terreno 3D, con un heatmap de tus salidas.' },
      { cap: 'Rutas que\nrepites', sub: 'Detectadas en tu historial, intentos lado a lado.' },
      {
        cap: 'Una lectura diaria\nde tu entrenamiento',
        sub: 'Récords de tramo, hitos, semana contra semana.',
      },
    ],
    tagline: 'Análisis de entrenamiento para bici y carrera.',
  },
  'de-DE': {
    shots: [
      { cap: 'Deine\nAktivitäten', sub: 'Synchronisiert aus deinem intervals.icu-Konto.' },
      {
        cap: 'Karte und Diagramme\nauf einer Zeitachse',
        sub: 'Zieh am Diagramm, die Markierung folgt.',
      },
      { cap: 'Fitness, Ermüdung\nund Form', sub: 'Aus deiner Trainingslast, Tag für Tag.' },
      { cap: 'Wo du\nunterwegs warst', sub: '3D-Gelände, mit einer Heatmap deiner Fahrten.' },
      {
        cap: 'Routen, die du\nwieder fährst',
        sub: 'In deinem Verlauf erkannt, Versuche nebeneinander.',
      },
      {
        cap: 'Dein Training,\njeden Tag im Blick',
        sub: 'Abschnittsbestzeiten, Meilensteine, Woche gegen Woche.',
      },
    ],
    tagline: 'Trainingsanalyse für Rad und Lauf.',
  },
  'nl-NL': {
    shots: [
      { cap: 'Je\nactiviteiten', sub: 'Gesynchroniseerd vanuit je intervals.icu-account.' },
      {
        cap: 'Kaart en grafieken\nop één tijdlijn',
        sub: 'Sleep over de grafiek en de markering volgt.',
      },
      { cap: 'Fitheid, vermoeidheid\nen vorm', sub: 'Uit je trainingsbelasting, dag na dag.' },
      { cap: 'Waar je\nhebt gefietst', sub: '3D-terrein, met een heatmap van je ritten.' },
      { cap: 'Routes die je\nvaker rijdt', sub: 'Gevonden in je historie, pogingen naast elkaar.' },
      {
        cap: 'Elke dag een blik\nop je training',
        sub: 'Sectierecords, mijlpalen, week tegen week.',
      },
    ],
    tagline: 'Trainingsanalyse voor fietsen en hardlopen.',
  },
  'pt-PT': {
    shots: [
      { cap: 'O teu histórico\nde atividades', sub: 'Sincronizado da tua conta intervals.icu.' },
      {
        cap: 'Mapa e gráficos\nnuma linha temporal',
        sub: 'Arrasta o gráfico e o marcador acompanha.',
      },
      { cap: 'Condição, fadiga\ne forma', sub: 'Traçadas a partir da tua carga, dia a dia.' },
      { cap: 'Por onde\npedalaste', sub: 'Terreno 3D, com um heatmap das tuas saídas.' },
      { cap: 'Percursos que\nrepetes', sub: 'Detetados no teu histórico, tentativas lado a lado.' },
      {
        cap: 'Uma leitura diária\ndo teu treino',
        sub: 'Recordes de troço, marcos, semana contra semana.',
      },
    ],
    tagline: 'Análise de treino para ciclismo e corrida.',
  },
  'pt-BR': {
    shots: [
      {
        cap: 'Seu histórico\nde atividades',
        sub: 'Sincronizado da sua conta do intervals.icu.',
      },
      {
        cap: 'Mapa e gráficos\nem uma linha do tempo',
        sub: 'Arraste o gráfico e o marcador acompanha.',
      },
      {
        cap: 'Condicionamento,\nfadiga e forma',
        sub: 'Traçados a partir da sua carga, dia a dia.',
      },
      { cap: 'Por onde\nvocê pedalou', sub: 'Terreno 3D, com um heatmap dos seus pedais.' },
      {
        cap: 'Rotas que\nvocê repete',
        sub: 'Detectadas no seu histórico, tentativas lado a lado.',
      },
      {
        cap: 'Uma leitura diária\ndo seu treino',
        sub: 'Recordes de trecho, marcos, semana contra semana.',
      },
    ],
    tagline: 'Análise de treino para ciclismo e corrida.',
  },
  'pl-PL': {
    shots: [
      { cap: 'Historia\ntwoich aktywności', sub: 'Synchronizowana z twojego konta intervals.icu.' },
      {
        cap: 'Mapa i wykresy\nna jednej osi czasu',
        sub: 'Przeciągnij wykres, a znacznik podąży za nim.',
      },
      { cap: 'Kondycja, zmęczenie\ni forma', sub: 'Z twojego obciążenia, dzień po dniu.' },
      { cap: 'Gdzie\njeździłeś', sub: 'Teren 3D z heatmapą twoich jazd.' },
      { cap: 'Trasy, które\npowtarzasz', sub: 'Wykryte w historii, próby obok siebie.' },
      {
        cap: 'Codzienny przegląd\ntwojego treningu',
        sub: 'Rekordy odcinków, kamienie milowe, tydzień do tygodnia.',
      },
    ],
    tagline: 'Analiza treningu dla roweru i biegania.',
  },
  'da-DK': {
    shots: [
      { cap: 'Din\naktivitetshistorik', sub: 'Synkroniseret fra din intervals.icu-konto.' },
      {
        cap: 'Kort og grafer\npå én tidslinje',
        sub: 'Træk i grafen, og markøren følger med.',
      },
      {
        cap: 'Kondition, træthed\nog form',
        sub: 'Tegnet ud fra din træningsbelastning, dag for dag.',
      },
      { cap: 'Hvor du\nhar cyklet', sub: '3D-terræn med et heatmap over dine ture.' },
      { cap: 'Ruter, du\nkører igen', sub: 'Fundet i din historik, forsøg side om side.' },
      {
        cap: 'Et dagligt blik\npå din træning',
        sub: 'Sektionsrekorder, milepæle, uge mod uge.',
      },
    ],
    tagline: 'Træningsanalyse til cykling og løb.',
  },
  'ja-JP': {
    shots: [
      { cap: 'アクティビティの\n履歴', sub: 'intervals.icu アカウントから同期。' },
      {
        cap: '地図とグラフを\nひとつのタイムラインで',
        sub: 'グラフをなぞるとマーカーが動きます。',
      },
      { cap: 'フィットネス、\n疲労、フォーム', sub: 'トレーニング負荷から日ごとにグラフ化。' },
      { cap: '走ってきた\n場所', sub: '3D 地形に、ライドのヒートマップを重ねて。' },
      { cap: 'くり返し走る\nルート', sub: '履歴から見つけ、挑戦を並べて比較。' },
      { cap: '毎日の\nトレーニング分析', sub: '区間ベスト、マイルストーン、週ごとの比較。' },
    ],
    tagline: 'ライドとランのトレーニング分析。',
  },
  'zh-CN': {
    shots: [
      { cap: '你的\n活动历史', sub: '从你的 intervals.icu 账户同步。' },
      { cap: '地图与图表\n同一条时间轴', sub: '拖动图表，标记随之移动。' },
      { cap: '体能、疲劳\n与状态', sub: '根据训练负荷逐日绘制。' },
      { cap: '你骑过的\n地方', sub: '3D 地形，叠加骑行热力图。' },
      { cap: '你反复骑的\n路线', sub: '从历史中识别，多次尝试并列对比。' },
      { cap: '每日\n训练解读', sub: '路段最佳、里程碑、逐周对比。' },
    ],
    tagline: '骑行与跑步的训练分析。',
  },
};

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

function rawPlatform(target: Target): string {
  if (target === 'appstore') return 'ios';
  if (target === 'ipad') return 'ipad';
  return 'android'; // play, feature, web
}

/**
 * A locale's raw captures for one target, in shot order. Play gets Android
 * captures, the App Store gets iOS captures. Throwing on a missing capture is
 * deliberate: a wrong-platform or wrong-language set must never ship silently
 * via fallback.
 */
export function rawCaptures(target: Target, rawRoot: string, locale: string, count: number) {
  const dir = path.join(rawRoot, rawPlatform(target), locale);
  const files = SHOT_STEMS.slice(0, count).map((stem) => path.join(dir, `${stem}.png`));
  const missing = files.filter((f) => !fs.existsSync(f));
  if (missing.length > 0) {
    throw new Error(
      `Missing raw captures for ${target} ${locale} in ${dir}:\n  ${missing
        .map((f) => path.basename(f))
        .join('\n  ')}\nRun the capture first (npm run store:screenshots).`
    );
  }
  const want = RAW_SIZES[target];
  if (want) {
    for (const file of files) {
      const info = readImageInfo(fs.readFileSync(file));
      if (!info || info.width !== want.width || info.height !== want.height) {
        throw new Error(
          `${file} is ${info ? `${info.width}x${info.height}` : 'unreadable'}, and the ` +
            `${target} slot takes ${want.width}x${want.height}: capture it on a simulator ` +
            `of that size.`
        );
      }
    }
  }
  return files;
}

function rawRoot(): string {
  return process.env.VELOQ_RAW_DIR ?? path.join(ROOT, 'artifacts', 'store', 'raw');
}

function buildLocale(locale: string, palette: StorePalette, targets: Target[]): void {
  const strings = CAPTIONS[locale];
  if (!strings) throw new Error(`No captions for locale ${locale}`);

  for (const target of targets.filter((t) => t === 'play' || t === 'appstore' || t === 'ipad')) {
    const size = SIZES[target];
    const count = target === 'ipad' ? IPAD_SHOTS : SHOT_STEMS.length;
    const raws = rawCaptures(target, rawRoot(), locale, count);
    const { offsets, width: markW } = markPositions(count);
    const d = dims(size.width, target === 'ipad');
    console.log(`${locale} ${target}`);
    raws.forEach((raw, i) => {
      const offset = offsets[i];
      const caption = strings.shots[i];
      if (offset === undefined || caption === undefined) {
        throw new Error(`${locale} has no caption or mark position for shot ${i + 1}`);
      }
      const html = phoneHtml(palette, d, offset, markW, caption, raw);
      const tmpPng = path.join(STORE, target, locale, `${String(i + 1).padStart(2, '0')}.png`);
      render(html, size.width, size.height, tmpPng);
      toJpeg(tmpPng, tmpPng.replace(/\.png$/, '.jpg'), palette.bg);
      fs.rmSync(tmpPng);
    });
  }

  if (targets.includes('feature')) {
    const [raw] = rawCaptures('feature', rawRoot(), locale, 1);
    if (!raw) throw new Error(`No raw capture for the ${locale} feature graphic`);
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

// The website shows every store shot from the same capture, under the shot's
// own name and its one-line caption, so the page names no file the capture
// does not write.
export function webShots(): SiteShot[] {
  const strings = CAPTIONS[WEB_LOCALE];
  if (!strings) throw new Error(`No captions for locale ${WEB_LOCALE}`);
  return SHOT_STEMS.map((stem, i) => {
    const caption = strings.shots[i];
    if (!caption) throw new Error(`${WEB_LOCALE} has no caption for shot ${i + 1}`);
    return { file: `${stem}.png`, caption: caption.cap.replace(/\n/g, ' ') };
  });
}

function buildWeb(): void {
  const raws = rawCaptures('web', rawRoot(), WEB_LOCALE, SHOT_STEMS.length);
  const shots = webShots();
  const dir = path.join(ROOT, 'docs', 'screenshots');
  console.log('web');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  raws.forEach((raw, i) => {
    const shot = shots[i];
    if (!shot) return;
    const out = path.join(dir, shot.file);
    execFileSync(MAGICK, [raw, '-resize', `${SIZES.web.width}x${SIZES.web.height}`, '-strip', out]);
    console.log(`  docs/screenshots/${shot.file}`);
  });
  const htmlPath = path.join(ROOT, 'docs', 'index.html');
  fs.writeFileSync(htmlPath, syncSiteGallery(fs.readFileSync(htmlPath, 'utf8'), shots));
  syncSiteCopy(ROOT);
  console.log('  docs/index.html gallery and hero synced');
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

/**
 * Write each capture's rendered sets into the fastlane trees of every locale
 * it installs into. Whole per-locale sets are replaced, never merged: supply
 * and deliver clobber the store set on upload, so the repo must be the single
 * source of truth. A capture with nothing rendered is refused before any
 * locale is touched, so a partial run never empties a live set.
 */
export function installSets(store: string, fastlane: string, captures: CaptureLocale[]): void {
  const rendered = (target: string, play: string) => {
    const dir = path.join(store, target, play);
    return fs.existsSync(dir) && fs.readdirSync(dir).some((f) => f.endsWith('.jpg')) ? dir : null;
  };
  const unrendered = captures.filter(
    (c) => !rendered('play', c.play) && !rendered('appstore', c.play)
  );
  if (unrendered.length > 0) {
    throw new Error(
      `Nothing rendered under ${store} for ${unrendered.map((c) => c.play).join(', ')}`
    );
  }

  for (const capture of captures) {
    const playSrc = rendered('play', capture.play);
    const appstoreSrc = rendered('appstore', capture.play);
    const ipadSrc = rendered('ipad', capture.play);
    const featureSrc = path.join(store, 'feature', capture.play, 'featureGraphic.jpg');

    if (playSrc) {
      for (const locale of capture.android) {
        const imagesDir = path.join(fastlane, 'metadata', 'android', locale, 'images');
        const phoneDir = path.join(imagesDir, 'phoneScreenshots');
        replaceDir(phoneDir);
        copySet(playSrc, phoneDir);
        if (fs.existsSync(featureSrc)) {
          fs.copyFileSync(featureSrc, path.join(imagesDir, 'featureGraphic.jpg'));
        }
        console.log(`installed play ${locale}`);
      }
    }
    if (appstoreSrc) {
      for (const locale of capture.ios) {
        const appleDir = path.join(fastlane, 'screenshots', locale);
        replaceDir(appleDir);
        copySet(appstoreSrc, appleDir);
        if (ipadSrc) copySet(ipadSrc, appleDir, (name) => `ipad-${name}`);
        console.log(`installed appstore ${locale}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function main(args: string[]): void {
  const flagValue = (flag: string): string | undefined => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : undefined;
  };

  const paletteName = (flagValue('--palette') ?? 'night') as 'night' | 'day';
  const targetArg = flagValue('--target') ?? 'all';
  const outDir = flagValue('--out');
  const rawDir = flagValue('--raw-dir');
  const installOnly = args.includes('--install');
  const siteCopyOnly = args.includes('--site-copy');
  const locales = args.filter(
    (a, i) =>
      !a.startsWith('--') &&
      args[i - 1] !== '--palette' &&
      args[i - 1] !== '--target' &&
      args[i - 1] !== '--out' &&
      args[i - 1] !== '--raw-dir'
  );

  if (process.env.VELOQ_STORE_DIR) STORE = process.env.VELOQ_STORE_DIR;
  if (outDir) STORE = path.resolve(outDir);
  if (rawDir) process.env.VELOQ_RAW_DIR = path.resolve(rawDir);

  const palette = storePalettes[paletteName];
  if (!palette) throw new Error(`Unknown palette ${paletteName}`);

  const targets: Target[] =
    targetArg === 'all' ? ['play', 'appstore', 'ipad', 'feature'] : [targetArg as Target];
  const all = captureLocales();
  const unknown = locales.filter((l) => !all.some((c) => c.play === l));
  if (unknown.length > 0) {
    throw new Error(
      `Not a captured locale: ${unknown.join(', ')}. Captured: ${all.map((c) => c.play).join(' ')}`
    );
  }
  const captures = locales.length > 0 ? all.filter((c) => locales.includes(c.play)) : all;

  if (siteCopyOnly) {
    syncSiteCopy(ROOT);
    console.log('docs/index.html hero and feature grid synced');
  } else if (installOnly) {
    if (outDir) throw new Error('--install always reads artifacts/store, not --out');
    installSets(STORE, FASTLANE, captures);
  } else {
    if (targets.includes('web')) buildWeb();
    const composited = targets.filter((t) => t !== 'web');
    if (composited.length > 0) {
      for (const capture of captures) buildLocale(capture.play, palette, composited);
    }
  }
}

if (/store-screenshots\.ts$/.test(process.argv[1] ?? '')) main(process.argv.slice(2));
