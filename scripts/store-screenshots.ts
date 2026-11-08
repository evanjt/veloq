#!/usr/bin/env npx tsx
/**
 * Store screenshot compositor: captioned device composites at exact store
 * sizes, rendered from HTML templates with headless Chromium, flattened to
 * JPEG with ImageMagick.
 *
 * Usage:
 *   npx tsx scripts/store-screenshots.ts [options] [locale ...]
 *
 *   --target <t>          all|play|appstore|ipad|feature|web  default all
 *   --install             mirror existing renders into the fastlane trees
 *   --site-copy           only rewrite the docs/index.html hero and feature grid from the listings
 *   --out <dir>           output root override; such runs never touch fastlane
 *   --raw-dir <dir>       raw capture root override (stand-in testing)
 *
 * A locale is a captured Play locale (scripts/store-locales.ts,
 * captureLocales), and no locale means every one. `npm run store:screenshots`
 * runs the captures, this, and --install, in that order.
 *
 * Raw captures land in artifacts/store/raw/{android,ios,ipad}/<locale>/ named
 * <stem>.png for the stems in scripts/store-shots.ts (see .maestro/store-capture.yaml), and stay
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

import {
  hasDistinctDark,
  syncReadmeStrip,
  syncSiteCopy,
  syncSiteGallery,
  type SitePlatform,
  type SiteSets,
} from './site-copy';
import { captureLocales, WEB_LOCALE, type CaptureLocale } from './store-locales';
import { CAPTURED_STEMS, SHOT_LAYOUTS, shotsFor, type StoreTarget } from './store-shots';
import {
  PANEL_LOCALES,
  PRIVACY_CAPTION,
  PRIVACY_CLAIMS,
  PRIVACY_CSS,
  privacyListHtml,
  SHOT_WIDGET_CSS,
  WIDGET_CSS,
  capturedScreenHtml,
  shotWidgetFile,
  WIDGETS_CAPTION,
  widgetFiles,
  widgetScreenHtml,
  type WidgetPlatform,
} from './store-panels';
import {
  deviceHtml,
  dims,
  featureHtml,
  FEATURE_SIZE,
  phoneHtml,
  textPanelHtml,
  type Caption,
} from './store-templates';

import { storePalette, type StorePalette } from './store-theme';
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

// The store target each website set is cut from, and the directory it is
// written under in docs/screenshots.
export const WEB_PLATFORMS: Record<SitePlatform, StoreTarget> = {
  android: 'play',
  ios: 'appstore',
  ipad: 'ipad',
};

const DEVICE_KIND = { play: 'android', appstore: 'iphone', ipad: 'ipad' } as const;

// Captions keyed by Play locale, one per captured shot in the order of
// CAPTURED_STEMS. Each shot has one headline that wraps in the template and
// fits two lines at slot width. It names what a still cannot show; the screen
// carries the rest. No absolutes, no speed promises, no coaching. The feature
// terms are the app's own words in that locale (src/i18n/locales).
export const CAPTIONS: Record<string, { shots: Caption[]; tagline: string }> = {
  'en-US': {
    shots: [
      { cap: 'Your training, kept on your phone' },
      { cap: 'Sections found in your own history' },
      { cap: 'Heatmaps on 3D terrain, offline' },
      { cap: 'Drag the chart, follow the map' },
      { cap: 'See your form at a glance' },
      { cap: 'Every insight shows its method' },
      { cap: 'Your strength sets, muscle by muscle' },
      { cap: "Follow a route or today's workout" },
    ],
    tagline: 'Training analysis for rides and runs.',
  },
  'it-IT': {
    shots: [
      { cap: 'Il tuo allenamento, salvato sul telefono' },
      { cap: 'Sezioni trovate nella tua storia' },
      { cap: 'Mappe di calore su terreno 3D, offline' },
      { cap: 'Trascina il grafico, segui la mappa' },
      { cap: "La tua forma, a colpo d'occhio" },
      { cap: 'Ogni analisi mostra il suo metodo' },
      { cap: 'Le tue serie di forza, muscolo per muscolo' },
      { cap: "Segui un percorso o l'allenamento di oggi" },
    ],
    tagline: 'Analisi degli allenamenti per bici e corsa.',
  },
  'fr-FR': {
    shots: [
      { cap: 'Votre entraînement, sur votre mobile' },
      { cap: 'Des sections trouvées dans votre historique' },
      { cap: 'Cartes de chaleur sur terrain 3D, hors ligne' },
      { cap: 'Glissez le graphique, la carte suit' },
      { cap: "Votre forme en un coup d'œil" },
      { cap: 'Chaque analyse montre sa méthode' },
      { cap: 'Vos séries de force, muscle par muscle' },
      { cap: "Suivez un parcours ou l'entraînement du jour" },
    ],
    tagline: "Analyse d'entraînement pour vélo et course.",
  },
  'es-ES': {
    shots: [
      { cap: 'Tu entrenamiento, en tu teléfono' },
      { cap: 'Secciones de tu propio historial' },
      { cap: 'Mapas de calor 3D, sin conexión' },
      { cap: 'Desliza el gráfico, sigue el mapa' },
      { cap: 'Tu forma de un vistazo' },
      { cap: 'Cada análisis muestra su método' },
      { cap: 'Tus series de fuerza, músculo a músculo' },
      { cap: 'Sigue una ruta o el entrenamiento de hoy' },
    ],
    tagline: 'Análisis de entrenamiento para bici y carrera.',
  },
  'es-419': {
    shots: [
      { cap: 'Tu entrenamiento, en tu celular' },
      { cap: 'Secciones de tu propio historial' },
      { cap: 'Mapas de calor 3D, sin conexión' },
      { cap: 'Desliza el gráfico, sigue el mapa' },
      { cap: 'Tu forma de un vistazo' },
      { cap: 'Cada análisis muestra su método' },
      { cap: 'Tus series de fuerza, músculo a músculo' },
      { cap: 'Sigue una ruta o el entrenamiento de hoy' },
    ],
    tagline: 'Análisis de entrenamiento para bici y carrera.',
  },
  'de-DE': {
    shots: [
      { cap: 'Dein Training, auf deinem Handy' },
      { cap: 'Abschnitte aus deiner eigenen Historie' },
      { cap: 'Heatmaps auf 3D-Gelände, offline' },
      { cap: 'Diagramm ziehen, Karte folgen' },
      { cap: 'Deine Form auf einen Blick' },
      { cap: 'Jede Analyse zeigt ihre Methode' },
      { cap: 'Deine Kraftsätze, Muskel für Muskel' },
      { cap: 'Route oder Tagestraining folgen' },
    ],
    tagline: 'Trainingsanalyse für Rad und Lauf.',
  },
  'nl-NL': {
    shots: [
      { cap: 'Je training, bewaard op je telefoon' },
      { cap: 'Secties uit je eigen geschiedenis' },
      { cap: 'Heatmaps op 3D-terrein, offline' },
      { cap: 'Sleep over de grafiek, volg de kaart' },
      { cap: 'Je vorm in één oogopslag' },
      { cap: 'Elk inzicht toont zijn methode' },
      { cap: 'Je krachtsets, spier voor spier' },
      { cap: 'Volg een route of de training van vandaag' },
    ],
    tagline: 'Trainingsanalyse voor fietsen en hardlopen.',
  },
  'pt-PT': {
    shots: [
      { cap: 'O teu treino, no telemóvel' },
      { cap: 'Secções do teu próprio histórico' },
      { cap: 'Mapas de calor em terreno 3D, offline' },
      { cap: 'Arrasta o gráfico, segue o mapa' },
      { cap: 'A tua forma num relance' },
      { cap: 'Cada análise mostra o seu método' },
      { cap: 'Séries de força, músculo a músculo' },
      { cap: 'Segue um percurso ou o treino de hoje' },
    ],
    tagline: 'Análise de treino para ciclismo e corrida.',
  },
  'pt-BR': {
    shots: [
      { cap: 'Seu treino, guardado no seu celular' },
      { cap: 'Seções do seu próprio histórico' },
      { cap: 'Mapas de calor em terreno 3D, offline' },
      { cap: 'Arraste o gráfico, siga o mapa' },
      { cap: 'Sua forma de relance' },
      { cap: 'Cada análise mostra o seu método' },
      { cap: 'Suas séries de força, músculo a músculo' },
      { cap: 'Siga uma rota ou o treino de hoje' },
    ],
    tagline: 'Análise de treino para ciclismo e corrida.',
  },
  'pl-PL': {
    shots: [
      { cap: 'Twój trening, zapisany w telefonie' },
      { cap: 'Odcinki znalezione w Twojej historii' },
      { cap: 'Mapy cieplne na terenie 3D, offline' },
      { cap: 'Przesuń wykres, śledź mapę' },
      { cap: 'Twoja forma na pierwszy rzut oka' },
      { cap: 'Każda analiza pokazuje metodę' },
      { cap: 'Twoje serie siłowe, mięsień po mięśniu' },
      { cap: 'Śledź trasę lub dzisiejszy trening' },
    ],
    tagline: 'Analiza treningu dla roweru i biegania.',
  },
  'da-DK': {
    shots: [
      { cap: 'Din træning, gemt på din telefon' },
      { cap: 'Sektioner fundet i din egen historik' },
      { cap: 'Varmekort på 3D-terræn, offline' },
      { cap: 'Træk i grafen, følg kortet' },
      { cap: 'Se din form med et blik' },
      { cap: 'Hver indsigt viser sin metode' },
      { cap: 'Dine styrkesæt, muskel for muskel' },
      { cap: 'Følg en rute eller dagens træning' },
    ],
    tagline: 'Træningsanalyse til cykling og løb.',
  },
  'ja-JP': {
    shots: [
      { cap: 'あなたのトレーニングを、スマホの中に' },
      { cap: '自分の履歴から見つかったセクション' },
      { cap: '3D地形のヒートマップ、オフラインで' },
      { cap: 'グラフをなぞれば、地図がついてくる' },
      { cap: 'コンディションをひと目で' },
      { cap: 'すべての分析に、その算出方法' },
      { cap: '筋肉ごとの筋トレセット' },
      { cap: 'ルートや今日のワークアウトをたどる' },
    ],
    tagline: 'ライドとランのトレーニング分析。',
  },
  'zh-CN': {
    shots: [
      { cap: '你的训练，保存在手机上' },
      { cap: '从你自己的历史中找出路段' },
      { cap: '3D 地形热力图，离线可用' },
      { cap: '拖动图表，地图跟随' },
      { cap: '体能状态一目了然' },
      { cap: '每项洞察都附带计算方法' },
      { cap: '按肌肉划分的力量训练组数' },
      { cap: '跟随路线或今日训练' },
    ],
    tagline: '骑行与跑步的训练分析。',
  },
  'en-AU': {
    shots: [
      { cap: 'Your training, kept on your phone' },
      { cap: 'Sections found in your own history' },
      { cap: 'Heatmaps on 3D terrain, offline' },
      { cap: 'Drag the chart, follow the map' },
      { cap: 'See your form at a glance' },
      { cap: 'Every insight shows its method' },
      { cap: 'Your strength sets, muscle by muscle' },
      { cap: "Follow a route or today's workout" },
    ],
    tagline: 'Training analysis for rides and runs.',
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

/** The raw captures a target is built from, in shot order. */
function captureStems(target: Exclude<Target, 'web'>): readonly string[] {
  if (target === 'feature') return CAPTURED_STEMS;
  return shotsFor(target)
    .filter((shot) => shot.source === 'captured')
    .map((shot) => shot.stem);
}

/**
 * A locale's raw captures for one target, in shot order. Play gets Android
 * captures, the App Store gets iOS captures. Throwing on a missing capture is
 * deliberate: a wrong-platform or wrong-language set must never ship silently
 * via fallback.
 */
export function rawCaptures(
  target: Exclude<Target, 'web'>,
  rawRoot: string,
  locale: string,
  count: number,
  theme: 'light' | 'dark' = 'light'
) {
  const base = path.join(rawRoot, rawPlatform(target), locale);
  const dir = theme === 'dark' ? path.join(base, 'dark') : base;
  const files = captureStems(target)
    .slice(0, count)
    .map((stem) => path.join(dir, `${stem}.png`));
  const missing = files.filter((f) => !fs.existsSync(f));
  if (missing.length > 0) {
    throw new Error(
      `Missing raw ${theme} captures for ${target} ${locale} in ${dir}:\n  ${missing
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

/**
 * The shots composition draws for a target: the widgets on a home screen from
 * the widget captures, and the privacy panel. Their text is English only, so
 * another locale's set stops short of them and says so.
 */
function composeShots(
  locale: string,
  target: 'play' | 'appstore' | 'ipad',
  palette: StorePalette,
  size: { width: number; height: number },
  d: ReturnType<typeof dims>
): void {
  const shots = shotsFor(target);
  const composed = shots.filter((shot) => shot.source === 'composed');
  if (composed.length === 0) return;
  if (!PANEL_LOCALES.includes(locale)) {
    console.log(`  ${locale} has no text for ${composed.map((s) => s.stem).join(', ')}, skipped`);
    return;
  }
  const platform: WidgetPlatform = target === 'appstore' || target === 'ipad' ? 'ios' : 'android';
  for (const shot of composed) {
    let html: string;
    if (shot.stem.endsWith('-widgets')) {
      const files = widgetFiles(rawRoot(), platform);
      html = deviceHtml(
        palette,
        d,
        WIDGETS_CAPTION,
        widgetScreenHtml(files),
        shot.layout,
        WIDGET_CSS(palette.washBlue, palette.stageBottom)
      );
    } else if (shot.stem.endsWith('-privacy')) {
      html = textPanelHtml(
        palette,
        d,
        PRIVACY_CAPTION,
        privacyListHtml(PRIVACY_CLAIMS),
        PRIVACY_CSS(palette.line, palette.tick, palette.cap)
      );
    } else {
      throw new Error(`No composition for shot ${shot.stem}`);
    }
    const number = String(shots.indexOf(shot) + 1).padStart(2, '0');
    const tmpPng = path.join(STORE, target, locale, `${number}.png`);
    render(html, size.width, size.height, tmpPng);
    toJpeg(tmpPng, tmpPng.replace(/\.png$/, '.jpg'), palette.stageTop);
    fs.rmSync(tmpPng);
  }
}

function buildLocale(locale: string, palette: StorePalette, targets: Target[]): void {
  const strings = CAPTIONS[locale];
  if (!strings) throw new Error(`No captions for locale ${locale}`);
  // Captions are positional, so a set written for another shot list would
  // label each shot with the wrong text.
  if (strings.shots.length !== CAPTURED_STEMS.length) {
    throw new Error(
      `${locale} has ${strings.shots.length} captions for ${CAPTURED_STEMS.length} captured shots in the list`
    );
  }

  for (const target of targets.filter((t) => t === 'play' || t === 'appstore' || t === 'ipad')) {
    const size = SIZES[target];
    const stems = captureStems(target);
    const raws = rawCaptures(target, rawRoot(), locale, stems.length);
    const d = dims(size.width, size.height, DEVICE_KIND[target]);
    console.log(`${locale} ${target}`);
    raws.forEach((raw, i) => {
      const stem = stems[i] ?? '';
      const caption = strings.shots[CAPTURED_STEMS.indexOf(stem)];
      if (caption === undefined) throw new Error(`${locale} has no caption for shot ${stem}`);
      const layout = SHOT_LAYOUTS[stem] ?? 'whole';
      const widget = shotWidgetFile(rawRoot(), target === 'play' ? 'android' : 'ios', stem);
      const html = widget
        ? deviceHtml(
            palette,
            d,
            caption,
            capturedScreenHtml(raw, widget),
            layout,
            SHOT_WIDGET_CSS(layout)
          )
        : phoneHtml(palette, d, caption, raw, layout);
      const tmpPng = path.join(STORE, target, locale, `${String(i + 1).padStart(2, '0')}.png`);
      render(html, size.width, size.height, tmpPng);
      toJpeg(tmpPng, tmpPng.replace(/\.png$/, '.jpg'), palette.stageTop);
      fs.rmSync(tmpPng);
    });
    composeShots(locale, target, palette, size, d);
  }

  if (targets.includes('feature')) {
    const [raw] = rawCaptures('feature', rawRoot(), locale, 1);
    if (!raw) throw new Error(`No raw capture for the ${locale} feature graphic`);
    const html = featureHtml(palette, strings.tagline, '', raw);
    const tmpPng = path.join(STORE, 'feature', locale, 'featureGraphic.png');
    console.log(`${locale} feature`);
    render(html, FEATURE_SIZE.width, FEATURE_SIZE.height, tmpPng);
    toJpeg(tmpPng, tmpPng.replace(/\.png$/, '.jpg'), palette.stageTop);
    fs.rmSync(tmpPng);
  }
}

// ---------------------------------------------------------------------------
// Website
// ---------------------------------------------------------------------------

// The pixel size each platform's raw captures come in, which sets the size its
// web images are expected at; buildWeb replaces it with the size it wrote.
const WEB_CAPTURE_SIZES: Record<SitePlatform, { width: number; height: number }> = {
  android: { width: 1080, height: 2400 },
  ios: SIZES.appstore,
  ipad: SIZES.ipad,
};

/** A size scaled to fit the web box, as ImageMagick's -resize does. */
function fitWeb(size: { width: number; height: number }) {
  const scale = Math.min(SIZES.web.width / size.width, SIZES.web.height / size.height);
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) };
}

/**
 * The website's shots per platform: each store target's captured shots, in the
 * store's order, under the one-line caption of the locale the site copy reads,
 * so the page names no file the capture does not write. A platform is sized
 * from its own slot, scaled to the web width.
 */
export function webSets(strings = CAPTIONS[WEB_LOCALE]): SiteSets {
  if (!strings) throw new Error(`No captions for locale ${WEB_LOCALE}`);
  const sets = {} as SiteSets;
  for (const platform of Object.keys(WEB_PLATFORMS) as SitePlatform[]) {
    const target = WEB_PLATFORMS[platform];
    const { width, height } = fitWeb(WEB_CAPTURE_SIZES[platform]);
    sets[platform] = captureStems(target).map((stem) => {
      const caption = strings.shots[CAPTURED_STEMS.indexOf(stem)];
      if (!caption) throw new Error(`${WEB_LOCALE} has no caption for shot ${stem}`);
      return {
        file: `${platform}/${stem}.png`,
        dark: `${platform}/dark/${stem}.png`,
        caption: caption.cap.replace(/\n/g, ' '),
        width,
        height,
      };
    });
  }
  return sets;
}

/**
 * The website's raw captures for one target, light and dark. The dark set is
 * captured in the app's dark theme, so a missing one is refused rather than
 * drawn from the light shots.
 */
export function webRaws(target: Exclude<Target, 'web'>, root: string) {
  const count = captureStems(target).length;
  return {
    raws: rawCaptures(target, root, WEB_LOCALE, count),
    darkRaws: rawCaptures(target, root, WEB_LOCALE, count, 'dark'),
  };
}

function buildWeb(): void {
  const sets = webSets();
  const dir = path.join(ROOT, 'docs', 'screenshots');
  const captures = Object.entries(WEB_PLATFORMS).map(([platform, target]) => ({
    platform: platform as SitePlatform,
    ...webRaws(target, rawRoot()),
  }));
  console.log('web');
  fs.rmSync(dir, { recursive: true, force: true });
  for (const { platform, raws, darkRaws } of captures) {
    fs.mkdirSync(path.join(dir, platform, 'dark'), { recursive: true });
    raws.forEach((raw, i) => {
      const shot = sets[platform][i];
      if (!shot?.dark) return;
      const size = `${shot.width}x${shot.height}`;
      execFileSync(MAGICK, [raw, '-resize', size, '-strip', path.join(dir, shot.file)]);
      execFileSync(MAGICK, [darkRaws[i], '-resize', size, '-strip', path.join(dir, shot.dark)]);
      const written = readImageInfo(fs.readFileSync(path.join(dir, shot.file)));
      if (written) Object.assign(shot, { width: written.width, height: written.height });
      console.log(`  docs/screenshots/${shot.file}`);
    });
    const written = sets[platform].flatMap((shot) =>
      shot.dark
        ? [{ light: fs.readFileSync(path.join(dir, shot.file)), dark: path.join(dir, shot.dark) }]
        : []
    );
    const distinct = hasDistinctDark(
      written.map((w) => w.light),
      written.map((w) => fs.readFileSync(w.dark))
    );
    if (distinct) continue;
    for (const w of written) fs.rmSync(w.dark);
    fs.rmSync(path.join(dir, platform, 'dark'), { recursive: true, force: true });
    for (const shot of sets[platform]) delete shot.dark;
  }
  const htmlPath = path.join(ROOT, 'docs', 'index.html');
  fs.writeFileSync(htmlPath, syncSiteGallery(fs.readFileSync(htmlPath, 'utf8'), sets));
  const readmePath = path.join(ROOT, 'README.md');
  fs.writeFileSync(readmePath, syncReadmeStrip(fs.readFileSync(readmePath, 'utf8'), sets.android));
  syncSiteCopy(ROOT);
  console.log('  docs/index.html gallery and hero, README.md strip synced');
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

  const targetArg = flagValue('--target') ?? 'all';
  const outDir = flagValue('--out');
  const rawDir = flagValue('--raw-dir');
  const installOnly = args.includes('--install');
  const siteCopyOnly = args.includes('--site-copy');
  const locales = args.filter(
    (a, i) =>
      !a.startsWith('--') &&
      args[i - 1] !== '--target' &&
      args[i - 1] !== '--out' &&
      args[i - 1] !== '--raw-dir'
  );

  if (process.env.VELOQ_STORE_DIR) STORE = process.env.VELOQ_STORE_DIR;
  if (outDir) STORE = path.resolve(outDir);
  if (rawDir) process.env.VELOQ_RAW_DIR = path.resolve(rawDir);

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
      for (const capture of captures) buildLocale(capture.play, storePalette, composited);
    }
  }
}

if (/store-screenshots\.ts$/.test(process.argv[1] ?? '')) main(process.argv.slice(2));
