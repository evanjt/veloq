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
// CAPTURED_STEMS. Text wraps in the template and each headline and subtitle
// fits two lines at slot width. Subcaptions describe what is on screen: no
// absolutes, no speed promises, no coaching. The kicker and the feature terms
// are the app's own words in that locale (src/i18n/locales).
export const CAPTIONS: Record<string, { shots: Caption[]; tagline: string }> = {
  'en-US': {
    shots: [
      {
        kicker: 'Feed',
        cap: 'Your intervals.icu activities',
        sub: 'A map and the key numbers for each one.',
      },
      {
        kicker: 'Map',
        cap: 'All your activities on one map',
        sub: 'A heatmap over 3D satellite terrain.',
      },
      {
        kicker: 'Activity',
        cap: 'Charts linked to the map',
        sub: 'Move along the chart to see where it happened.',
      },
      {
        kicker: 'Sections',
        cap: 'See how you did, from the notification',
        sub: 'Your time on each section you repeat, compared with your best.',
      },
      {
        kicker: 'Insights',
        cap: 'What changed in your training',
        sub: 'Records and trends, with how each one is worked out.',
      },
      {
        kicker: 'Fitness',
        cap: 'Fitness, fatigue and form',
        sub: 'Also on your home screen as a widget.',
      },
      {
        kicker: 'Strength',
        cap: 'Strength training by muscle group',
        sub: 'Sets from your workouts on a body diagram.',
      },
      {
        kicker: 'Recording',
        cap: 'Record rides and runs',
        sub: 'GPS, indoor or manual, with Bluetooth sensors, uploaded to intervals.icu.',
      },
    ],
    tagline: 'Training analysis for rides and runs.',
  },
  'en-AU': {
    shots: [
      {
        kicker: 'Feed',
        cap: 'Your intervals.icu activities',
        sub: 'A map and the key numbers for each one.',
      },
      {
        kicker: 'Map',
        cap: 'All your activities on one map',
        sub: 'A heatmap over 3D satellite terrain.',
      },
      {
        kicker: 'Activity',
        cap: 'Charts linked to the map',
        sub: 'Move along the chart to see where it happened.',
      },
      {
        kicker: 'Sections',
        cap: 'See how you did, from the notification',
        sub: 'Your time on each section you repeat, compared with your best.',
      },
      {
        kicker: 'Insights',
        cap: 'What changed in your training',
        sub: 'Records and trends, with how each one is worked out.',
      },
      {
        kicker: 'Fitness',
        cap: 'Fitness, fatigue and form',
        sub: 'Also on your home screen as a widget.',
      },
      {
        kicker: 'Strength',
        cap: 'Strength training by muscle group',
        sub: 'Sets from your workouts on a body diagram.',
      },
      {
        kicker: 'Recording',
        cap: 'Record rides and runs',
        sub: 'GPS, indoor or manual, with Bluetooth sensors, uploaded to intervals.icu.',
      },
    ],
    tagline: 'Training analysis for rides and runs.',
  },
  'it-IT': {
    shots: [
      {
        kicker: 'Notizie',
        cap: 'Le tue attività di intervals.icu',
        sub: 'Una mappa e i numeri chiave di ognuna.',
      },
      {
        kicker: 'Mappa',
        cap: 'Tutte le attività su una mappa',
        sub: 'Una mappa di calore su terreno 3D satellitare.',
      },
      {
        kicker: 'Attività',
        cap: 'Grafici collegati alla mappa',
        sub: 'Scorri il grafico per vedere dove è successo.',
      },
      {
        kicker: 'Sezioni',
        cap: "Scopri com'è andata, dalla notifica",
        sub: 'Il tuo tempo su ogni sezione che ripeti, confrontato con il tuo migliore.',
      },
      {
        kicker: 'Analisi',
        cap: 'Cosa è cambiato nel tuo allenamento',
        sub: 'Primati e tendenze, con il calcolo di ciascuno.',
      },
      {
        kicker: 'Forma',
        cap: 'Fitness, affaticamento e forma',
        sub: 'Anche sulla schermata Home come widget.',
      },
      {
        kicker: 'Forza',
        cap: 'Allenamento di forza per gruppo muscolare',
        sub: 'Serie dei tuoi allenamenti su uno schema del corpo.',
      },
      {
        kicker: 'Registrazione',
        cap: 'Registra uscite e corse',
        sub: 'GPS, indoor o manuale, con sensori Bluetooth, caricato su intervals.icu.',
      },
    ],
    tagline: 'Analisi degli allenamenti per bici e corsa.',
  },
  'fr-FR': {
    shots: [
      {
        kicker: 'Fil',
        cap: 'Vos activités intervals.icu',
        sub: 'Une carte et les chiffres clés de chacune.',
      },
      {
        kicker: 'Carte',
        cap: 'Toutes vos activités sur une carte',
        sub: 'Une carte thermique sur un terrain 3D satellite.',
      },
      {
        kicker: 'Activité',
        cap: 'Des graphiques liés à la carte',
        sub: "Parcourez le graphique pour voir où cela s'est passé.",
      },
      {
        kicker: 'Sections',
        cap: 'Voyez votre résultat depuis la notification',
        sub: 'Votre temps sur chaque section répétée, comparé à votre meilleur.',
      },
      {
        kicker: 'Aperçus',
        cap: 'Ce qui a changé dans votre entraînement',
        sub: 'Records et tendances, avec leur mode de calcul.',
      },
      {
        kicker: 'Forme',
        cap: 'Forme physique, fatigue et forme',
        sub: "Aussi sur votre écran d'accueil, en widget.",
      },
      {
        kicker: 'Force',
        cap: 'Musculation par groupe musculaire',
        sub: 'Séries de vos séances sur un schéma du corps.',
      },
      {
        kicker: 'Enregistrement',
        cap: 'Enregistrez vos sorties et courses',
        sub: 'GPS, en salle ou manuel, avec capteurs Bluetooth, envoyé vers intervals.icu.',
      },
    ],
    tagline: "Analyse d'entraînement pour vélo et course.",
  },
  'es-ES': {
    shots: [
      {
        kicker: 'Inicio',
        cap: 'Tus actividades de intervals.icu',
        sub: 'Un mapa y los datos clave de cada una.',
      },
      {
        kicker: 'Mapa',
        cap: 'Todas tus actividades en un mapa',
        sub: 'Un mapa de calor sobre terreno 3D por satélite.',
      },
      {
        kicker: 'Actividad',
        cap: 'Gráficos enlazados con el mapa',
        sub: 'Recorre el gráfico para ver dónde ocurrió.',
      },
      {
        kicker: 'Secciones',
        cap: 'Mira cómo te fue, desde la notificación',
        sub: 'Tu tiempo en cada sección que repites, comparado con tu mejor marca.',
      },
      {
        kicker: 'Análisis',
        cap: 'Qué cambió en tu entrenamiento',
        sub: 'Récords y tendencias, con cómo se calcula cada uno.',
      },
      {
        kicker: 'Forma física',
        cap: 'Forma física, fatiga y forma',
        sub: 'También en tu pantalla de inicio como widget.',
      },
      {
        kicker: 'Fuerza',
        cap: 'Fuerza por grupo muscular',
        sub: 'Series de tus entrenamientos en un diagrama corporal.',
      },
      {
        kicker: 'Grabación',
        cap: 'Graba salidas en bici y carreras',
        sub: 'GPS, interior o manual, con sensores Bluetooth, subido a intervals.icu.',
      },
    ],
    tagline: 'Análisis de entrenamiento para bici y carrera.',
  },
  'es-419': {
    shots: [
      {
        kicker: 'Inicio',
        cap: 'Tus actividades de intervals.icu',
        sub: 'Un mapa y los datos clave de cada una.',
      },
      {
        kicker: 'Mapa',
        cap: 'Todas tus actividades en un mapa',
        sub: 'Un mapa de calor sobre terreno 3D por satélite.',
      },
      {
        kicker: 'Actividad',
        cap: 'Gráficos enlazados con el mapa',
        sub: 'Desliza el dedo por el gráfico para ver dónde ocurrió.',
      },
      {
        kicker: 'Secciones',
        cap: 'Mira cómo te fue, desde la notificación',
        sub: 'Tu tiempo en cada sección que repites, comparado con tu mejor marca.',
      },
      {
        kicker: 'Análisis',
        cap: 'Qué cambió en tu entrenamiento',
        sub: 'Récords y tendencias, con cómo se calcula cada uno.',
      },
      {
        kicker: 'Condición física',
        cap: 'Condición física, fatiga y forma',
        sub: 'También en tu pantalla de inicio como widget.',
      },
      {
        kicker: 'Fuerza',
        cap: 'Fuerza por grupo muscular',
        sub: 'Series de tus entrenamientos en un diagrama corporal.',
      },
      {
        kicker: 'Grabación',
        cap: 'Graba salidas en bici y carreras',
        sub: 'GPS, interior o manual, con sensores Bluetooth, subido a intervals.icu.',
      },
    ],
    tagline: 'Análisis de entrenamiento para bici y carrera.',
  },
  'de-DE': {
    shots: [
      {
        kicker: 'Feed',
        cap: 'Deine intervals.icu-Aktivitäten',
        sub: 'Eine Karte und die wichtigsten Werte zu jeder.',
      },
      {
        kicker: 'Karte',
        cap: 'Alle Aktivitäten auf einer Karte',
        sub: 'Eine Heatmap über 3D-Satellitengelände.',
      },
      {
        kicker: 'Aktivität',
        cap: 'Diagramme mit der Karte verknüpft',
        sub: 'Fahre am Diagramm entlang und sieh, wo es war.',
      },
      {
        kicker: 'Abschnitte',
        cap: 'Dein Ergebnis direkt per Benachrichtigung',
        sub: 'Deine Zeit auf jedem Abschnitt, den du wiederholst, im Vergleich zu deiner Bestzeit.',
      },
      {
        kicker: 'Einblicke',
        cap: 'Was sich in deinem Training geändert hat',
        sub: 'Rekorde und Trends, mit dem Rechenweg dazu.',
      },
      {
        kicker: 'Fitness',
        cap: 'Fitness, Ermüdung und Form',
        sub: 'Auch als Widget auf deinem Startbildschirm.',
      },
      {
        kicker: 'Kraft',
        cap: 'Krafttraining nach Muskelgruppe',
        sub: 'Sätze aus deinen Workouts an einer Körpergrafik.',
      },
      {
        kicker: 'Aufnahme',
        cap: 'Fahrten und Läufe aufzeichnen',
        sub: 'GPS, indoor oder manuell, mit Bluetooth-Sensoren, hochgeladen zu intervals.icu.',
      },
    ],
    tagline: 'Trainingsanalyse für Rad und Lauf.',
  },
  'nl-NL': {
    shots: [
      {
        kicker: 'Feed',
        cap: 'Je intervals.icu-activiteiten',
        sub: 'Een kaart en de belangrijkste cijfers van elk.',
      },
      {
        kicker: 'Kaart',
        cap: 'Al je activiteiten op één kaart',
        sub: 'Een heatmap over 3D-satellietterrein.',
      },
      {
        kicker: 'Activiteit',
        cap: 'Grafieken gekoppeld aan de kaart',
        sub: 'Ga langs de grafiek om te zien waar het was.',
      },
      {
        kicker: 'Secties',
        cap: 'Zie je resultaat in de melding',
        sub: 'Je tijd op elke sectie die je herhaalt, vergeleken met je beste.',
      },
      {
        kicker: 'Inzichten',
        cap: 'Wat er in je training veranderde',
        sub: 'Records en trends, met hoe elk is berekend.',
      },
      {
        kicker: 'Fitheid',
        cap: 'Fitheid, vermoeidheid en vorm',
        sub: 'Ook op je beginscherm als widget.',
      },
      {
        kicker: 'Kracht',
        cap: 'Krachttraining per spiergroep',
        sub: 'Sets uit je workouts op een lichaamsschema.',
      },
      {
        kicker: 'Opname',
        cap: 'Neem ritten en runs op',
        sub: 'GPS, indoor of handmatig, met Bluetooth-sensoren, geüpload naar intervals.icu.',
      },
    ],
    tagline: 'Trainingsanalyse voor fietsen en hardlopen.',
  },
  'pt-PT': {
    shots: [
      {
        kicker: 'Feed',
        cap: 'As tuas atividades do intervals.icu',
        sub: 'Um mapa e os números principais de cada uma.',
      },
      {
        kicker: 'Mapa',
        cap: 'Todas as atividades num só mapa',
        sub: 'Um mapa de calor sobre terreno 3D de satélite.',
      },
      {
        kicker: 'Atividade',
        cap: 'Gráficos ligados ao mapa',
        sub: 'Percorre o gráfico para ver onde aconteceu.',
      },
      {
        kicker: 'Troços',
        cap: 'Vê como correu, logo na notificação',
        sub: 'O teu tempo em cada troço que repetes, comparado com o teu melhor.',
      },
      {
        kicker: 'Insights',
        cap: 'O que mudou no teu treino',
        sub: 'Recordes e tendências, com o cálculo de cada um.',
      },
      {
        kicker: 'Forma',
        cap: 'Condição, fadiga e forma',
        sub: 'Também no ecrã inicial, como widget.',
      },
      {
        kicker: 'Força',
        cap: 'Treino de força por grupo muscular',
        sub: 'Séries dos teus treinos num diagrama do corpo.',
      },
      {
        kicker: 'Gravação',
        cap: 'Grava pedaladas e corridas',
        sub: 'GPS, interior ou manual, com sensores Bluetooth, enviado para o intervals.icu.',
      },
    ],
    tagline: 'Análise de treino para ciclismo e corrida.',
  },
  'pt-BR': {
    shots: [
      {
        kicker: 'Feed',
        cap: 'Suas atividades do intervals.icu',
        sub: 'Um mapa e os números principais de cada uma.',
      },
      {
        kicker: 'Mapa',
        cap: 'Todas as atividades em um só mapa',
        sub: 'Um mapa de calor sobre terreno 3D de satélite.',
      },
      {
        kicker: 'Atividade',
        cap: 'Gráficos ligados ao mapa',
        sub: 'Percorra o gráfico para ver onde aconteceu.',
      },
      {
        kicker: 'Trechos',
        cap: 'Veja como foi, direto na notificação',
        sub: 'Seu tempo em cada trecho que você repete, comparado ao seu melhor.',
      },
      {
        kicker: 'Insights',
        cap: 'O que mudou no seu treino',
        sub: 'Recordes e tendências, com o cálculo de cada um.',
      },
      {
        kicker: 'Forma',
        cap: 'Condicionamento, fadiga e forma',
        sub: 'Também na tela inicial, como widget.',
      },
      {
        kicker: 'Força',
        cap: 'Treino de força por grupo muscular',
        sub: 'Séries dos seus treinos em um diagrama do corpo.',
      },
      {
        kicker: 'Gravação',
        cap: 'Grave pedaladas e corridas',
        sub: 'GPS, indoor ou manual, com sensores Bluetooth, enviado ao intervals.icu.',
      },
    ],
    tagline: 'Análise de treino para ciclismo e corrida.',
  },
  'pl-PL': {
    shots: [
      {
        kicker: 'Główna',
        cap: 'Twoje aktywności z intervals.icu',
        sub: 'Mapa i najważniejsze liczby każdej z nich.',
      },
      {
        kicker: 'Mapa',
        cap: 'Wszystkie aktywności na jednej mapie',
        sub: 'Mapa cieplna na satelitarnym terenie 3D.',
      },
      {
        kicker: 'Aktywność',
        cap: 'Wykresy powiązane z mapą',
        sub: 'Przesuwaj się po wykresie, by zobaczyć, gdzie to było.',
      },
      {
        kicker: 'Odcinki',
        cap: 'Wynik od razu w powiadomieniu',
        sub: 'Twój czas na każdym powtarzanym odcinku, w porównaniu z najlepszym.',
      },
      {
        kicker: 'Analizy',
        cap: 'Co zmieniło się w Twoim treningu',
        sub: 'Rekordy i trendy, z opisem, jak je policzono.',
      },
      {
        kicker: 'Kondycja',
        cap: 'Kondycja, zmęczenie i forma',
        sub: 'Także na ekranie głównym jako widżet.',
      },
      {
        kicker: 'Siła',
        cap: 'Trening siłowy według grup mięśni',
        sub: 'Serie z treningów na schemacie ciała.',
      },
      {
        kicker: 'Nagrywanie',
        cap: 'Nagrywaj jazdy i biegi',
        sub: 'GPS, w pomieszczeniu lub ręcznie, z czujnikami Bluetooth, wysyłane do intervals.icu.',
      },
    ],
    tagline: 'Analiza treningu dla roweru i biegania.',
  },
  'da-DK': {
    shots: [
      {
        kicker: 'Forside',
        cap: 'Dine aktiviteter fra intervals.icu',
        sub: 'Et kort og nøgletallene for hver enkelt.',
      },
      {
        kicker: 'Kort',
        cap: 'Alle dine aktiviteter på ét kort',
        sub: 'Et heatmap over 3D-satellitterræn.',
      },
      {
        kicker: 'Aktivitet',
        cap: 'Grafer knyttet til kortet',
        sub: 'Bevæg dig langs grafen for at se, hvor det skete.',
      },
      {
        kicker: 'Sektioner',
        cap: 'Se resultatet i notifikationen',
        sub: 'Din tid på hver sektion, du gentager, sammenlignet med din bedste.',
      },
      {
        kicker: 'Indsigt',
        cap: 'Hvad der ændrede sig i din træning',
        sub: 'Rekorder og tendenser, med hvordan hver er regnet ud.',
      },
      {
        kicker: 'Kondition',
        cap: 'Kondition, træthed og formstatus',
        sub: 'Også på din startskærm som widget.',
      },
      {
        kicker: 'Styrke',
        cap: 'Styrketræning efter muskelgruppe',
        sub: 'Sæt fra dine træninger på et kropsdiagram.',
      },
      {
        kicker: 'Optagelse',
        cap: 'Optag ture og løb',
        sub: 'GPS, indendørs eller manuelt, med Bluetooth-sensorer, uploadet til intervals.icu.',
      },
    ],
    tagline: 'Træningsanalyse til cykling og løb.',
  },
  'ja-JP': {
    shots: [
      {
        kicker: 'フィード',
        cap: 'intervals.icu のアクティビティ',
        sub: '地図と主な数値を、一つずつ。',
      },
      {
        kicker: 'マップ',
        cap: 'すべてのアクティビティを一枚の地図に',
        sub: '3D 衛星地形の上にヒートマップ。',
      },
      {
        kicker: 'アクティビティ',
        cap: 'グラフと地図が連動',
        sub: 'グラフをなぞると、その場所が分かります。',
      },
      {
        kicker: '区間',
        cap: '通知からそのまま結果を確認',
        sub: '繰り返す区間ごとのタイムを、自己ベストと比較。',
      },
      {
        kicker: '分析',
        cap: 'トレーニングの変化',
        sub: '記録とトレンド、それぞれの算出方法つき。',
      },
      {
        kicker: 'フィットネス',
        cap: 'フィットネス、疲労、フォーム',
        sub: 'ホーム画面のウィジェットでも確認できます。',
      },
      {
        kicker: '筋力',
        cap: '筋群別の筋力トレーニング',
        sub: 'ワークアウトのセットを人体図に表示。',
      },
      {
        kicker: '記録',
        cap: 'ライドとランを記録',
        sub: 'GPS、屋内、手動に対応。Bluetooth センサー対応で、intervals.icu にアップロード。',
      },
    ],
    tagline: 'ライドとランのトレーニング分析。',
  },
  'zh-CN': {
    shots: [
      { kicker: '动态', cap: '你的 intervals.icu 活动', sub: '每项活动都有地图和关键数据。' },
      { kicker: '地图', cap: '所有活动，一张地图', sub: '3D 卫星地形上的热力图。' },
      { kicker: '活动', cap: '图表与地图联动', sub: '沿图表移动，查看发生的位置。' },
      {
        kicker: '路段',
        cap: '直接从通知查看表现',
        sub: '你重复骑行的每个路段的用时，与最佳成绩对比。',
      },
      { kicker: '洞察', cap: '训练有什么变化', sub: '纪录与趋势，并说明各自的计算方式。' },
      { kicker: '体能', cap: '体能、疲劳与状态', sub: '也可作为小组件显示在主屏幕上。' },
      { kicker: '力量', cap: '按肌群划分的力量训练', sub: '训练中的组数显示在人体图上。' },
      {
        kicker: '录制',
        cap: '录制骑行和跑步',
        sub: 'GPS、室内或手动，支持蓝牙传感器，并上传到 intervals.icu。',
      },
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
        PRIVACY_CSS(palette.line, palette.kickerAchievement, palette.cap)
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
      if (!shot) return;
      const size = `${shot.width}x${shot.height}`;
      execFileSync(MAGICK, [raw, '-resize', size, '-strip', path.join(dir, shot.file)]);
      execFileSync(MAGICK, [darkRaws[i], '-resize', size, '-strip', path.join(dir, shot.dark)]);
      const written = readImageInfo(fs.readFileSync(path.join(dir, shot.file)));
      if (written) Object.assign(shot, { width: written.width, height: written.height });
      console.log(`  docs/screenshots/${shot.file}`);
    });
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
