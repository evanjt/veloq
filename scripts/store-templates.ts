// The HTML templates the store compositor renders, apart from its command line
// so a template can be read without rendering anything.
import * as path from 'node:path';

import { deviceFrame, type DeviceKind, type ShotLayout } from './store-device';
import { storeLayout, type StorePalette } from './store-theme';
import { trackLayer, trackSvg } from './store-tracks';

const ROOT = path.resolve(__dirname, '..');
// The app's own bundled faces, so a composite reads in the app's type and
// renders the same on any host.
const FONTS = path.join(ROOT, 'assets', 'fonts');
// The outlined logo the icon generator writes. It is drawn as it is, never
// typeset again here.
const LOGO = path.join(ROOT, 'src', 'assets', 'logos', 'logo.svg');

export interface Caption {
  /** The screen's name, above the headline. Absent where a locale has none yet. */
  kicker?: string;
  cap: string;
  sub: string;
  /** A shot about a record or a milestone: its kicker takes the gold role. */
  achievement?: boolean;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface Dims {
  width: number;
  height: number;
  pad: number;
  cap: number;
  sub: number;
  kicker: number;
  kind: DeviceKind;
  headH: number;
}

export function dims(width: number, height: number, kind: DeviceKind): Dims {
  const pad = Math.floor(width * storeLayout.padRatio);
  const cap = Math.floor(width * storeLayout.capRatio);
  const sub = Math.floor(cap * storeLayout.subRatio);
  const kicker = Math.floor(cap * storeLayout.kickerRatio);
  return {
    width,
    height,
    pad,
    cap,
    sub,
    kicker,
    kind,
    // The kicker line, two headline lines at line-height 1.06, the subtitle's
    // top margin, then two subtitle lines at 1.32. Two of each is the worst
    // case any locale needs; reserving it keeps the device at one height
    // across the whole set.
    headH: Math.round(kicker * 1.4 + 2 * cap * 1.06 + cap * 0.26 + 2 * sub * 1.32),
  };
}

export function makeCss(p: StorePalette): string {
  return `
  @font-face { font-family: 'Store'; src: url('file://${FONTS}/Manrope-Bold.ttf'); font-weight: 700; }
  @font-face { font-family: 'StoreKicker'; src: url('file://${FONTS}/Manrope-SemiBold.ttf'); font-weight: 600; }
  @font-face { font-family: 'StoreText'; src: url('file://${FONTS}/Manrope-Regular.ttf'); font-weight: 400; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; }
  body {
    position: relative;
    background:
      radial-gradient(70% 45% at 85% 62%, ${p.washGold} 0%, ${p.washGoldClear} 70%),
      radial-gradient(80% 55% at 10% 80%, ${p.washBlue} 0%, ${p.washBlueClear} 70%),
      linear-gradient(180deg, ${p.stageTop} 0%, ${p.stageBottom} 100%);
    font-family: 'StoreText', sans-serif;
  }
  .tracks { position: absolute; left: 0; top: 0; }
  .canvas { position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; padding: var(--pad); }
  .kicker {
    font-family: 'StoreKicker', sans-serif;
    font-weight: 600;
    font-size: var(--kicker);
    letter-spacing: 0.06em;
    margin-bottom: calc(var(--kicker) * 0.5);
  }
  .kicker { color: ${p.kicker}; }
  .kicker.gold { color: ${p.kickerAchievement}; }
  .caption {
    font-family: 'Store', sans-serif;
    font-weight: 700;
    font-size: var(--cap);
    line-height: 1.06;
    letter-spacing: -0.015em;
    color: ${p.cap};
    white-space: pre-line;
  }
  .sub {
    margin-top: calc(var(--cap) * 0.26);
    font-size: var(--sub);
    line-height: 1.32;
    font-weight: 400;
    color: ${p.sub};
  }
  .head { height: var(--headh); }
  .stage { flex: 1; position: relative; }
  .device {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    top: 0;
    width: var(--devw);
    height: var(--devh);
    border-radius: var(--devr);
    padding: var(--bezel);
    background: ${p.bezel};
    box-shadow: ${p.shadow};
  }
  .screen { display: block; width: 100%; height: 100%; border-radius: var(--scr); }
  .cutout { position: absolute; background: ${p.bezel}; }
  .cutout.circle { border-radius: 50%; }
  .cutout.pill { border-radius: 9999px; }
`;
}

function kickerHtml(caption: Caption): string {
  if (!caption.kicker) return '';
  return `<div class="kicker${caption.achievement ? ' gold' : ''}">${caption.kicker}</div>`;
}

export function phoneHtml(
  p: StorePalette,
  d: Dims,
  caption: Caption,
  screen: string,
  layout: ShotLayout = 'whole'
): string {
  return deviceHtml(p, d, caption, `<img class="screen" src="file://${screen}">`, layout);
}

/** A device whose screen is the given markup, under the caption. */
export function deviceHtml(
  p: StorePalette,
  d: Dims,
  caption: Caption,
  screenHtml: string,
  layout: ShotLayout = 'whole',
  extraCss = ''
): string {
  const f = deviceFrame(d.kind, d, layout);
  const cutout = f.cutout
    ? `<div class="cutout ${f.cutout.shape}" style="left:${f.bezel + f.cutout.left}px;top:${f.bezel + f.cutout.top}px;width:${f.cutout.width}px;height:${f.cutout.height}px"></div>`
    : '';
  const tracks = trackSvg(trackLayer(d.width, d.height), p.line, Math.max(2, d.width / 360));
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
${makeCss(p)}
:root {
  --pad: ${d.pad}px; --cap: ${d.cap}px; --sub: ${d.sub}px; --kicker: ${d.kicker}px;
  --headh: ${d.headH}px; --devw: ${f.outerWidth}px; --devh: ${f.outerHeight}px; --devr: ${f.outerRadius}px;
  --scr: ${f.screenRadius}px; --bezel: ${f.bezel}px;
}
${extraCss}
</style></head>
<body>
  ${tracks}
  <div class="canvas">
    <div class="head">
      ${kickerHtml(caption)}
      <div class="caption">${caption.cap}</div>
      <div class="sub">${caption.sub}</div>
    </div>
    <div class="stage">
      <div class="device">${screenHtml}${cutout}</div>
    </div>
  </div>
</body></html>
`;
}

/** The caption over a body of markup, with no device. */
export function textPanelHtml(
  p: StorePalette,
  d: Dims,
  caption: Caption,
  bodyHtml: string,
  extraCss = ''
): string {
  const tracks = trackSvg(trackLayer(d.width, d.height), p.line, Math.max(2, d.width / 360));
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
${makeCss(p)}
:root { --pad: ${d.pad}px; --cap: ${d.cap}px; --sub: ${d.sub}px; --kicker: ${d.kicker}px; }
${extraCss}
</style></head>
<body>
  ${tracks}
  <div class="canvas">
    ${kickerHtml(caption)}
    <div class="caption">${caption.cap}</div>
    <div class="sub">${caption.sub}</div>
    ${bodyHtml}
  </div>
</body></html>
`;
}

export const FEATURE_SIZE = { width: 1024, height: 500 };

export function featureHtml(
  p: StorePalette,
  headline: string,
  tagline: string,
  screen: string
): string {
  const tracks = trackSvg(trackLayer(FEATURE_SIZE.width, FEATURE_SIZE.height), p.line, 2);
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
${makeCss(p)}
:root { --pad: 0px; --cap: 52px; --sub: 25px; }
.canvas { flex-direction: row; align-items: center; padding: 0 64px; gap: 56px; }
.left { flex: 1; }
.logo { display: block; width: 132px; height: 132px; margin-left: -4px; }
.left .caption { margin-top: 30px; }
.left .sub { margin-top: 12px; }
.right { height: 100%; position: relative; width: 300px; flex: none; }
.phone {
  position: absolute;
  width: 250px; left: 20px; top: 46px;
  border-radius: 30px;
  border: 7px solid ${p.bezel};
  box-shadow: ${p.shadow};
}
</style></head>
<body>
  ${tracks}
  <div class="canvas">
    <div class="left">
      <img class="logo" src="file://${LOGO}">
      <div class="caption">${headline}</div>
      <div class="sub">${tagline}</div>
    </div>
    <div class="right"><img class="phone" src="file://${screen}"></div>
  </div>
</body></html>
`;
}
