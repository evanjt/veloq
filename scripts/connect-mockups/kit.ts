// The pieces a mock-up is assembled from, run inside the connect page once a
// screen has drawn. A mock-up keeps the page's own map, charts and tables and
// moves them into the arrangement the page spec draws; what the page does not
// have yet (a Manage panel, a bulk bar, an actions menu) is built here from the
// kit's own class names, so it paints with the site's styles and tokens.

type Child = Node | string | null | undefined | false;
type Attributes = Record<string, string | number | boolean | undefined>;

/** An element with attributes and children; `false`, `null` and `undefined` children are left out. */
export function h(tag: string, attributes: Attributes = {}, ...children: Child[]): HTMLElement {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined) continue;
    // An ARIA state is a word, `true` or `false`; any other attribute is present or absent.
    if (key.startsWith('aria-')) element.setAttribute(key, String(value));
    else if (value !== false) element.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return element;
}

/** The element the page drew for `selector`; a mock-up that names a missing part fails loudly. */
export function take(selector: string, root: ParentNode = document): HTMLElement {
  const found = root.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`the page has no ${selector}`);
  return found;
}

/** The first element matching `selector` whose text is `text`. */
export function byText(selector: string, text: string, root: ParentNode = document): HTMLElement {
  const found = [...root.querySelectorAll<HTMLElement>(selector)].find(
    (element) => element.textContent?.trim() === text
  );
  if (!found) throw new Error(`the page has no ${selector} reading ${text}`);
  return found;
}

export const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Waits for `selector` to be drawn, for parts that appear after a click. */
export async function drawn(selector: string, limitMs = 8_000): Promise<HTMLElement> {
  const started = Date.now();
  for (;;) {
    const found = document.querySelector<HTMLElement>(selector);
    if (found) return found;
    if (Date.now() - started > limitMs) throw new Error(`the page never drew ${selector}`);
    await wait(50);
  }
}

export function button(
  label: string,
  variant: 'primary' | 'secondary' | 'ghost' | 'destructive' = 'secondary',
  size: 'sm' | 'md' = 'sm'
): HTMLElement {
  return h(
    'button',
    { type: 'button', class: 'ui-button', 'data-variant': variant, 'data-size': size },
    label
  );
}

/** The actions menu: a button, and when `open` the menu under it with its items. */
export function menu(items: string[], open = false): HTMLElement {
  return h(
    'span',
    { class: 'ui-menu-wrap mock-menu-wrap' },
    h(
      'button',
      {
        type: 'button',
        class: 'ui-button',
        'data-variant': 'secondary',
        'data-size': 'sm',
        'aria-expanded': open,
      },
      'More',
      h('span', { class: 'mock-caret', 'aria-hidden': 'true' }, '▾')
    ),
    open
      ? h(
          'div',
          { class: 'ui-menu mock-menu', role: 'menu' },
          ...items.map((item) => h('button', { type: 'button', role: 'menuitem' }, item))
        )
      : null
  );
}

export function badge(label: string, tone?: 'good' | 'warning' | 'bad' | 'record'): HTMLElement {
  return h('span', { class: 'ui-badge', 'data-tone': tone }, label);
}

export function card(title: string | null, ...children: Child[]): HTMLElement {
  return h(
    'section',
    { class: 'ui-card' },
    title ? h('header', { class: 'ui-card-header' }, h('h2', {}, title)) : null,
    ...children
  );
}

/** A key figure: its label, the figure, and what it moved by. */
export function tile(
  label: string,
  value: string,
  delta?: string,
  tone?: 'up' | 'down'
): HTMLElement {
  return h(
    'div',
    { class: 'mock-tile' },
    h('span', { class: 'mock-tile-label' }, label),
    h('span', { class: 'mock-tile-value' }, value),
    delta ? h('span', { class: 'mock-tile-delta', 'data-tone': tone }, delta) : null
  );
}

export function strip(...tiles: HTMLElement[]): HTMLElement {
  return h('div', { class: 'mock-strip' }, ...tiles);
}

export function toggle(on: boolean): HTMLElement {
  return h('span', { class: 'mock-switch', role: 'switch', 'aria-checked': on });
}

export type Setting =
  | { label: string; note?: string; on: boolean }
  | { label: string; note?: string; field: string }
  | { label: string; note?: string; action: string; tone?: 'destructive' }
  | { group: string };

/** Every setting of one item in one card, each with the control that changes it. */
export function manage(item: string, settings: Setting[]): HTMLElement {
  return h(
    'section',
    { class: 'ui-card mock-manage', 'aria-label': `Manage ${item}` },
    h(
      'header',
      { class: 'ui-card-header' },
      h('h2', {}, 'Manage'),
      h('span', { class: 'mock-quiet' }, item)
    ),
    h(
      'ul',
      { class: 'mock-settings' },
      ...settings.map((setting) => {
        if ('group' in setting) return h('li', { class: 'mock-settings-group' }, setting.group);
        const control =
          'on' in setting
            ? toggle(setting.on)
            : 'field' in setting
              ? h('input', {
                  class: 'mock-field',
                  value: setting.field,
                  'aria-label': setting.label,
                })
              : button(setting.action, setting.tone ?? 'secondary');
        return h(
          'li',
          {},
          h(
            'span',
            { class: 'mock-setting-text' },
            h('span', {}, setting.label),
            setting.note ? h('small', {}, setting.note) : null
          ),
          control
        );
      })
    )
  );
}

/** The bar a table shows over a selection: the count, then each action the selection can take. */
export function bulkBar(count: number, noun: string, actions: string[]): HTMLElement {
  return h(
    'div',
    { class: 'ui-table-bar mock-bulk' },
    h(
      'div',
      { class: 'ui-table-bulk', role: 'toolbar' },
      h('strong', {}, `${count} ${noun} selected`),
      ...actions.map((action) => h('button', { type: 'button' }, action)),
      h('button', { type: 'button' }, 'Clear')
    )
  );
}

/** Ticks the first `count` rows of a kit table, as a selection would. */
export function selectRows(table: ParentNode, rows: number[]): void {
  const all = [...table.querySelectorAll<HTMLTableRowElement>('tbody tr')];
  for (const at of rows) {
    const row = all[at];
    if (!row) continue;
    row.setAttribute('aria-selected', 'true');
    const box = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (box) box.checked = true;
  }
}

/** A kit table from rows of text, numeric columns right aligned. */
export function table(
  columns: { label: string; numeric?: boolean }[],
  rows: Child[][]
): HTMLElement {
  return h(
    'div',
    { class: 'ui-table-frame' },
    h(
      'div',
      { class: 'ui-table-scroll' },
      h(
        'table',
        { class: 'ui-table' },
        h(
          'thead',
          {},
          h(
            'tr',
            {},
            ...columns.map((column) => h('th', { 'data-numeric': column.numeric }, column.label))
          )
        ),
        h(
          'tbody',
          {},
          ...rows.map((row) =>
            h(
              'tr',
              {},
              ...row.map((cell, at) => h('td', { 'data-numeric': columns[at]?.numeric }, cell))
            )
          )
        )
      )
    )
  );
}

/** A grid of named areas: `columns` as CSS, `children` in order. */
export function grid(className: string, ...children: Child[]): HTMLElement {
  return h('div', { class: `mock-grid ${className}` }, ...children);
}

/**
 * The top bar's one search, at its right: the palette and the in-page search
 * become one field that finds pages, actions, settings and items.
 */
export function oneSearch(): void {
  document.querySelector('#topbar-palette')?.remove();
  const old = document.querySelector('#topbar-search');
  const field = h(
    'span',
    { class: 'mock-topsearch' },
    h('span', { class: 'mock-quiet' }, 'Search activities, routes, sections, settings'),
    h('kbd', {}, 'Ctrl K')
  );
  if (old) old.replaceWith(field);
  const chip = document.querySelector('#topbar #status, #topbar .connection-chip');
  if (chip?.parentElement) chip.parentElement.insertBefore(field, chip);
}

interface LiveMap {
  getContainer: () => HTMLElement;
  getBounds: () => unknown;
  getZoom: () => number;
  loaded: () => boolean;
  isMoving: () => boolean;
  resize: () => void;
  fitBounds: (bounds: unknown, options: { padding: number; duration: number }) => void;
}

/**
 * Every map on the page with the ground it shows now. The page keeps its maps to
 * itself, so each is found through the renderer's own events: a pointer leaving
 * a canvas makes its map fire one, and the patched `fire` names the map. A
 * pointer move would do the same and light whatever line it passes over.
 */
async function liveMaps(): Promise<Map<LiveMap, unknown>> {
  const renderer = (
    window as unknown as { maplibregl?: { Map: { prototype: Record<string, unknown> } } }
  ).maplibregl;
  const found = new Map<LiveMap, unknown>();
  if (!renderer) return found;
  const prototype = renderer.Map.prototype;
  const fire = prototype.fire as (this: LiveMap, ...rest: unknown[]) => unknown;
  prototype.fire = function (this: LiveMap, ...rest: unknown[]) {
    if (!found.has(this)) found.set(this, this.getBounds());
    return fire.apply(this, rest);
  };
  for (const canvas of document.querySelectorAll('canvas.maplibregl-canvas')) {
    canvas.dispatchEvent(
      new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })
    );
  }
  await wait(100);
  prototype.fire = fire;
  return found;
}

/** A map zoomed out to the whole world, as one that has not yet framed its data is. */
const UNFRAMED_ZOOM = 3;

/**
 * Waits until every map on the page has framed what it shows: loaded, at rest and closer than the
 * world view. A map found before that would be put back at the world view by `mount`, which
 * restores the ground each map showed when it was found.
 */
export async function framed(limitMs = 10_000): Promise<void> {
  const started = Date.now();
  for (;;) {
    const maps = [...(await liveMaps()).keys()];
    if (maps.every((map) => map.loaded() && !map.isMoving() && map.getZoom() >= UNFRAMED_ZOOM)) {
      return;
    }
    if (Date.now() - started > limitMs) throw new Error('a map on the page never framed its data');
    await wait(100);
  }
}

/**
 * The share of the pixels of `box` in a screenshot that differ from the colour most of them have,
 * so a map that drew its lines reads well above one that drew only ground. `shot` is the PNG as a
 * data URL and `box` is in CSS pixels of the viewport; `skipTop` leaves out a strip along the top,
 * where a map writes its attribution.
 */
export async function inkShare(shot: string, box: DOMRect, skipTop = 0): Promise<number> {
  const image = new Image();
  image.src = shot;
  await image.decode();
  const scale = image.naturalWidth / window.innerWidth;
  const left = Math.max(0, Math.round(box.left * scale));
  const top = Math.max(0, Math.round((box.top + skipTop) * scale));
  const width = Math.min(image.naturalWidth, Math.round(box.right * scale)) - left;
  const height = Math.min(image.naturalHeight, Math.round(box.bottom * scale)) - top;
  if (width <= 0 || height <= 0) return 0;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('the page has no 2d canvas to read the screenshot with');
  context.drawImage(image, left, top, width, height, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  const counts = new Map<number, number>();
  for (let at = 0; at < data.length; at += 4) {
    const colour =
      ((data[at] as number) << 16) | ((data[at + 1] as number) << 8) | (data[at + 2] as number);
    counts.set(colour, (counts.get(colour) ?? 0) + 1);
  }
  const commonest = Math.max(...counts.values());
  return 1 - commonest / (width * height);
}

/**
 * Puts `root` where the page's own content was, and lets maps and charts take
 * their new sizes. With no root the page keeps its own content, rearranged in
 * place, and its maps stay where they were drawn.
 */
export async function mount(root: HTMLElement | null): Promise<void> {
  const maps = await liveMaps();
  const main = take('main#content');
  if (root) {
    for (const child of [...main.children]) (child as HTMLElement).style.display = 'none';
    main.scrollTop = 0;
    main.append(root);
  }
  oneSearch();
  for (let pass = 0; pass < 3; pass += 1) {
    window.dispatchEvent(new Event('resize'));
    await wait(300);
  }
  // A moved map keeps its camera at the new size; frame what it showed before.
  for (const [map, bounds] of maps) {
    if (!map.getContainer().isConnected) continue;
    map.resize();
    map.fitBounds(bounds, { padding: 0, duration: 0 });
  }
  await wait(300);
}

export function page(className: string, ...children: Child[]): HTMLElement {
  return h('div', { class: `mock-page ${className}` }, ...children);
}

/** A mock-up's own styles, every value a token of the generated set. */
export const STYLES = `
.mock-page { display: flex; flex-direction: column; gap: var(--space-md); max-width: 2000px; padding-bottom: var(--space-xl); }
.mock-page.mock-full { max-width: none; }
.mock-grid { display: grid; gap: var(--space-md); min-width: 0; }
.mock-grid > * { min-width: 0; }
.mock-quiet { color: var(--colour-text-secondary); font-size: var(--web-type-small-size); line-height: var(--web-type-small-line); }
.mock-strip { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: var(--space-sm-plus); }
.mock-tile { display: flex; align-items: baseline; gap: var(--space-sm); padding: var(--space-sm) var(--space-md); background: var(--colour-surface); border: var(--stroke-1) solid var(--colour-card-edge); border-radius: var(--web-radius-md); min-width: 0; }
.mock-tile-label { color: var(--colour-text-secondary); font-size: var(--web-type-small-size); line-height: var(--web-type-small-line); white-space: nowrap; }
.mock-tile-value { color: var(--colour-text-primary); font-size: var(--web-type-title-size); line-height: var(--web-type-title-line); font-weight: var(--web-type-title-weight); font-variant-numeric: tabular-nums; white-space: nowrap; }
.mock-tile-delta { color: var(--colour-text-secondary); font-size: var(--web-type-caption-size); line-height: var(--web-type-caption-line); white-space: nowrap; }
.mock-tile-delta[data-tone='up'] { color: var(--colour-success-text); }
.mock-tile-delta[data-tone='down'] { color: var(--colour-warning-text); }
.mock-switch { position: relative; display: inline-block; flex: none; width: var(--space-xxl); height: var(--space-lg); border-radius: var(--web-radius-full); background: var(--colour-control-boundary); }
.mock-switch::after { content: ''; position: absolute; top: var(--space-xxs); left: var(--space-xxs); width: calc(var(--space-lg) - 2 * var(--space-xxs)); height: calc(var(--space-lg) - 2 * var(--space-xxs)); border-radius: var(--web-radius-full); background: var(--colour-surface); }
.mock-switch[aria-checked='true'] { background: var(--colour-control-on); }
.mock-switch[aria-checked='true']::after { left: auto; right: var(--space-xxs); }
.mock-manage .ui-card-header { align-items: baseline; }
.mock-settings { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.mock-settings li { display: flex; align-items: center; justify-content: space-between; gap: var(--space-md); min-height: var(--web-size-row); padding: var(--space-xs) 0; border-top: var(--stroke-1) solid var(--colour-border); color: var(--colour-text-primary); font-size: var(--web-type-body-size); line-height: var(--web-type-body-line); }
.mock-settings li.mock-settings-group { border-top: none; padding-top: var(--space-sm); color: var(--colour-text-secondary); font-size: var(--web-type-caption-size); line-height: var(--web-type-caption-line); font-weight: var(--web-type-heading-weight); text-transform: uppercase; }
.mock-setting-text { display: flex; flex-direction: column; min-width: 0; }
.mock-setting-text small { color: var(--colour-text-secondary); font-size: var(--web-type-caption-size); line-height: var(--web-type-caption-line); }
.mock-field { width: 100%; max-width: calc(var(--web-layout-selection-panel) - 2 * var(--space-xl)); height: var(--web-size-control-small); padding: 0 var(--space-sm); border: var(--stroke-1) solid var(--colour-control-boundary); border-radius: var(--web-radius-sm); background: var(--colour-surface-input); color: var(--colour-text-primary); font: inherit; }
.mock-menu-wrap { position: relative; display: inline-flex; }
.mock-caret { margin-left: var(--space-xs); }
.mock-menu { position: absolute; top: calc(100% + var(--space-xs)); right: 0; z-index: var(--layer-floating); min-width: calc(var(--web-layout-list-pane) * 0.7); }
.mock-bulk { position: sticky; top: 0; }
.mock-topsearch { display: inline-flex; align-items: center; justify-content: space-between; gap: var(--space-md); width: var(--web-layout-selection-panel); height: var(--web-size-control-small); padding: 0 var(--space-sm); border: var(--stroke-1) solid var(--colour-control-boundary); border-radius: var(--web-radius-sm); background: var(--colour-surface-input); }
.mock-topsearch kbd { font-family: var(--font-mono); font-size: var(--web-type-caption-size); color: var(--colour-text-secondary); }
.mock-section-title { margin: 0; color: var(--colour-text-primary); font-size: var(--web-type-heading-size); line-height: var(--web-type-heading-line); font-weight: var(--web-type-heading-weight); }
.mock-swatch[data-at='0'] { background: var(--colour-section-1); }
.mock-swatch[data-at='1'] { background: var(--colour-section-2); }
.mock-swatch[data-at='2'] { background: var(--colour-section-3); }
.mock-swatch { display: inline-block; width: var(--space-sm-plus); height: var(--space-sm-plus); border-radius: var(--web-radius-full); margin-right: var(--space-xs); vertical-align: middle; }
.mock-legend { display: flex; flex-wrap: wrap; gap: var(--space-md); color: var(--colour-text-primary); font-size: var(--web-type-small-size); }
.mock-note { margin: 0; color: var(--colour-text-secondary); font-size: var(--web-type-small-size); line-height: var(--web-type-small-line); }
.mock-hidden { display: none !important; }
`;

/**
 * Adds `css` as a constructed sheet: the page's content security policy refuses
 * an inline style element, and a sheet built through the object model is not one.
 */
export function addStyles(css: string): void {
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(css);
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
}
