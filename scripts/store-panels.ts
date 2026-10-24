// The two composed store shots: the widgets on a home screen, and the privacy
// panel. Their facts come from the tree: the widgets a platform ships are read
// from its widget sources, and each privacy claim is held by a check against
// the tree that a test names.
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { Caption } from './store-templates';

export type WidgetPlatform = 'android' | 'ios';

/** The widget kinds the app ships, by the name the capture scripts give them. */
export const WIDGET_NAMES = ['summary', 'activity', 'insights', 'strength'] as const;
export type WidgetName = (typeof WIDGET_NAMES)[number];

const IOS_KIND_NAMES: Record<string, WidgetName> = {
  VeloqWidget: 'summary',
  VeloqLatestActivityWidget: 'activity',
  VeloqInsightsWidget: 'insights',
  VeloqStrengthWidget: 'strength',
};

function walk(dir: string, accept: (file: string) => boolean): string[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? walk(path.join(dir, e.name), accept)
        : accept(e.name)
          ? [path.join(dir, e.name)]
          : []
    );
}

/**
 * The widgets a platform ships, from its own sources: Android's appwidget
 * provider infos, iOS's widget configurations (the record control is a control,
 * not a widget).
 */
export function shippedWidgets(root: string, platform: WidgetPlatform): string[] {
  if (platform === 'android') {
    const dir = path.join(root, 'widget', 'android', 'res', 'xml');
    return fs
      .readdirSync(dir)
      .filter((f) => /^(veloq_widget|widget_.+)_info\.xml$/.test(f))
      .map((f) =>
        f === 'veloq_widget_info.xml' ? 'summary' : f.replace(/^widget_|_info\.xml$/g, '')
      )
      .sort();
  }
  const kinds = new Set<string>();
  for (const file of walk(path.join(root, 'widget', 'ios', 'VeloqWidget'), (f) =>
    f.endsWith('.swift')
  )) {
    const src = fs.readFileSync(file, 'utf8');
    if (!/(Static|AppIntent)Configuration\(/.test(src)) continue;
    for (const m of src.matchAll(/let kind = "([^"]+)"/g)) kinds.add(m[1] ?? '');
  }
  return [...kinds].map((k) => IOS_KIND_NAMES[k] ?? k).sort();
}

/** How big each widget is drawn on the home screen. */
type WidgetSize = 'small' | 'wide';

export interface WidgetPlacement {
  name: WidgetName;
  size: WidgetSize;
  /** The capture the scripts write for it, in the light theme with the demo library. */
  file: Record<WidgetPlatform, string>;
}

const place = (
  name: WidgetName,
  size: WidgetSize,
  android: string,
  ios: string
): WidgetPlacement => ({
  name,
  size,
  file: { android: `${name}-${android}-demo-light.png`, ios: `${name}-${ios}-demo-light.png` },
});

export const WIDGET_PLACEMENTS: readonly WidgetPlacement[] = [
  place('summary', 'wide', '4x2', 'medium-430'),
  place('activity', 'small', '2x2', 'small-430'),
  place('insights', 'wide', '4x2', 'medium-430'),
  place('strength', 'wide', '4x2', 'medium-430'),
];

/** Where the capture scripts leave the widget PNGs inside the raw tree. */
export function widgetDir(rawRoot: string, platform: WidgetPlatform): string {
  return path.join(rawRoot, platform, 'widgets');
}

export function widgetFiles(rawRoot: string, platform: WidgetPlatform): string[] {
  const dir = widgetDir(rawRoot, platform);
  const files = WIDGET_PLACEMENTS.map((p) => path.join(dir, p.file[platform]));
  const missing = files.filter((f) => !fs.existsSync(f));
  if (missing.length > 0) {
    throw new Error(
      `Missing widget captures in ${dir}:\n  ${missing.map((f) => path.basename(f)).join('\n  ')}\n` +
        `Run scripts/widget-captures-${platform === 'ios' ? 'ios' : 'android'}.sh with a raw tree.`
    );
  }
  return files;
}

/** The widget a captured shot carries on its screen, by stem. */
export const SHOT_WIDGETS: Readonly<Record<string, WidgetName>> = {
  '06-fitness': 'summary',
  '07-strength': 'strength',
};

/** The widget capture a captured shot carries on its screen, or none. */
export function shotWidgetFile(
  rawRoot: string,
  platform: WidgetPlatform,
  stem: string
): string | undefined {
  const name = SHOT_WIDGETS[stem];
  if (name === undefined) return undefined;
  const placement = WIDGET_PLACEMENTS.find((p) => p.name === name);
  const file = placement && path.join(widgetDir(rawRoot, platform), placement.file[platform]);
  if (!file || !fs.existsSync(file)) {
    throw new Error(
      `Missing widget capture ${file ?? name} for shot ${stem}.\n` +
        `Run scripts/widget-captures-${platform === 'ios' ? 'ios' : 'android'}.sh with a raw tree.`
    );
  }
  return file;
}

/** A captured shot's screen markup: the capture, and its widget drawn over it when it has one. */
export function capturedScreenHtml(raw: string, widgetFile?: string): string {
  const widget = widgetFile ? `<img class="shot-widget" src="file://${widgetFile}">` : '';
  return `<img class="screen" src="file://${raw}">${widget}`;
}

export const SHOT_WIDGET_CSS = (layout: 'whole' | 'detail'): string => `
  .shot-widget { position: absolute; left: 6%; width: 88%; height: auto; border-radius: 6%;
    ${layout === 'whole' ? 'bottom: 6%;' : 'top: 60%;'} box-shadow: 0 6px 24px rgba(0, 0, 0, 0.28); }
`;

/** The widget shot's own markup: the widgets on a plain wallpaper, inside the screen. */
export function widgetScreenHtml(files: readonly string[]): string {
  const cells = WIDGET_PLACEMENTS.map(
    (p, i) => `<img class="widget ${p.size}" src="file://${files[i]}">`
  ).join('');
  return `<div class="screen wallpaper"><div class="widgets">${cells}</div></div>`;
}

export const WIDGET_CSS = (wallTop: string, wallBottom: string): string => `
  .wallpaper { background: linear-gradient(180deg, ${wallTop} 0%, ${wallBottom} 100%); overflow: hidden; }
  .widgets { display: flex; flex-wrap: wrap; align-content: flex-start; gap: 4%; padding: 16% 6% 0; }
  .widget { display: block; height: auto; border-radius: 6%; margin-bottom: 4%; }
  .widget.wide { width: 100%; }
  .widget.small { width: 48%; }
`;

// ---------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------

export interface PrivacyClaim {
  id: string;
  text: string;
  /** Names what in the tree holds the claim. Returns what breaks it; empty holds. */
  check: (root: string) => string[];
}

const read = (root: string, ...p: string[]) => fs.readFileSync(path.join(root, ...p), 'utf8');

/** Libraries that collect usage or crash reports. */
const COLLECTORS =
  /sentry|firebase\/analytics|crashlytics|amplitude|mixpanel|segment|bugsnag|datadog|posthog|appcenter|flurry|instabug|react-native-firebase|appsflyer|adjust/i;

/** The hosts under veloq.fit the app may name: the OAuth proxy and the site. */
const FIRST_PARTY_HOSTS = new Set(['auth.veloq.fit', 'veloq.fit', 'www.veloq.fit']);

export const PRIVACY_CLAIMS: readonly PrivacyClaim[] = [
  {
    id: 'no-account',
    text: 'No Veloq account',
    check: (root) => {
      const hosts = new Set<string>();
      for (const file of walk(path.join(root, 'src'), (f) => /\.tsx?$/.test(f))) {
        if (file.includes(`${path.sep}__tests__${path.sep}`)) continue;
        for (const m of read(file).matchAll(/[a-z0-9.-]*veloq\.fit/g)) hosts.add(m[0]);
      }
      return [...hosts].filter((h) => !FIRST_PARTY_HOSTS.has(h)).map((h) => `names host ${h}`);
    },
  },
  {
    id: 'no-analytics',
    text: 'No analytics or crash reporting',
    check: (root) => {
      const pkg = JSON.parse(read(root, 'package.json')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
      return names.filter((n) => COLLECTORS.test(n)).map((n) => `depends on ${n}`);
    },
  },
  {
    id: 'on-device',
    text: 'Your data stays on the phone',
    check: (root) => {
      const cargo = read(root, 'modules', 'veloqrs', 'rust', 'veloqrs', 'Cargo.toml');
      return /^rusqlite\b/m.test(cargo) ? [] : ['the engine has no on-device SQLite'];
    },
  },
  {
    id: 'open-source',
    text: 'Open source',
    check: (root) => {
      const file = path.join(root, 'LICENSE');
      return fs.existsSync(file) && fs.statSync(file).size > 0 ? [] : ['LICENSE is missing'];
    },
  },
];

/** The privacy panel: a headline and its claims on the stage, no device. */
export function privacyListHtml(claims: readonly PrivacyClaim[]): string {
  return `<ul class="claims">${claims.map((c) => `<li>${c.text}</li>`).join('')}</ul>`;
}

export const PRIVACY_CSS = (line: string, tick: string, text: string): string => `
  .claims { list-style: none; margin-top: calc(var(--cap) * 1.2); }
  .claims li {
    font-family: 'Store', sans-serif; font-weight: 700;
    font-size: calc(var(--cap) * 0.62); color: ${text};
    padding: calc(var(--cap) * 0.5) 0; border-top: 2px solid ${line};
    display: flex; align-items: center; gap: calc(var(--cap) * 0.4);
  }
  .claims li::before { content: ''; width: calc(var(--cap) * 0.3); height: calc(var(--cap) * 0.3); border-radius: 50%; background: ${tick}; }
`;

/** English only: the panels' text has no translations yet. */
export const PANEL_LOCALES: readonly string[] = ['en-US', 'en-AU'];

export const WIDGETS_CAPTION: Caption = {
  kicker: 'Widgets',
  cap: 'Your training, on the home screen',
  sub: 'Summary, latest activity, insights and strength.',
};

export const PRIVACY_CAPTION: Caption = {
  kicker: 'Privacy',
  cap: 'Open source, no Veloq account',
  sub: 'Your data stays on your phone, with no analytics.',
};
