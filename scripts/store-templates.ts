// The HTML templates the store compositor renders, apart from its command line
// so a template can be read without rendering anything.
import * as path from 'node:path';

import { storeLayout, type StorePalette } from '@/shared/theme/storeTheme';

const ROOT = path.resolve(__dirname, '..');
// The app's own bundled faces, so a composite reads in the app's type and
// renders the same on any host.
const FONTS = path.join(ROOT, 'assets', 'fonts');
// The outlined logo the icon generator writes. It is drawn as it is, never
// typeset again here.
const LOGO = path.join(ROOT, 'src', 'assets', 'logos', 'logo.svg');

export interface Caption {
  cap: string;
  sub: string;
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface Dims {
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

export function dims(width: number, tablet: boolean): Dims {
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
export function markPositions(count: number): { offsets: string[]; width: string } {
  const width = 81 / count;
  const step = (100 - width) / (count - 1);
  return {
    offsets: Array.from({ length: count }, (_, i) => `${(i * step).toPrecision(4)}%`),
    width: `${width.toPrecision(4)}%`,
  };
}

export function makeCss(p: StorePalette): string {
  return `
  @font-face { font-family: 'Store'; src: url('file://${FONTS}/Manrope-Bold.ttf'); font-weight: 700; }
  @font-face { font-family: 'StoreText'; src: url('file://${FONTS}/Manrope-Regular.ttf'); font-weight: 400; }
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

export function phoneHtml(
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

export function featureHtml(p: StorePalette, tagline: string, screen: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
${makeCss(p)}
:root { --pad: 0px; --cap: 86px; --sub: 30px; --rule: 5px; --glow: 70px; --markw: 27%; }
.canvas { flex-direction: row; align-items: center; padding: 0 64px; gap: 56px; }
.left { flex: 1; }
.logo { display: block; width: 168px; height: 168px; margin-left: -5px; }
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
      <img class="logo" src="file://${LOGO}">
      <div class="rule"></div>
      <div class="tagline">${tagline}</div>
    </div>
    <div class="right"><img class="phone" src="file://${screen}"></div>
  </div>
</body></html>
`;
}
