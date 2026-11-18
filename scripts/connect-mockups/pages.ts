// One arrangement per page of the page spec. Each runs on the page the
// mock-up names once it has drawn, takes the page's own parts and puts them
// where the spec says, then marks itself done for the capture.

import {
  badge,
  bulkBar,
  button,
  byText,
  card,
  drawn,
  framed,
  grid,
  h,
  inkShare,
  addStyles,
  STYLES,
  manage,
  menu,
  mount,
  page,
  selectRows,
  strip,
  table,
  take,
  tile,
  wait,
} from './kit';

type Arrangement = () => Promise<void>;

/** The figure the page printed under `label` in a definition list. */
function figure(label: string, root: ParentNode = document): string {
  const term = [...root.querySelectorAll('dt')].find((dt) => dt.textContent?.trim() === label);
  return term?.nextElementSibling?.textContent?.trim() ?? '';
}

/** The width the mock-up page has to lay out in: the content area, capped as the plan caps it. */
function contentWidth(): number {
  const main = take('main#content');
  const style = getComputedStyle(main);
  const inner = main.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  return Math.min(inner, 2000);
}

const WIDE = 2200;
const GAP = 16;

/**
 * Gives the page's map the size it has in the mock-up, then leaves the page and
 * comes back, so the page frames its map at that size itself. A map here does
 * not zoom out past its first framing, so one framed large and moved small
 * would show only part of its line.
 */
async function preframe(
  selector: string,
  size: { width: number; height: number },
  hash: string,
  ready: () => boolean
): Promise<void> {
  addStyles(
    `${selector} { width: ${Math.round(size.width)}px !important; height: ${Math.round(size.height)}px !important; min-height: 0 !important; flex: none !important; aspect-ratio: auto !important; }`
  );
  location.hash = '#/activities';
  await drawn('#feed-scroll tbody tr');
  location.hash = hash;
  const started = Date.now();
  while (!ready()) {
    if (Date.now() - started > 15_000) throw new Error(`${hash} never drew again`);
    await wait(100);
  }
  await wait(1500);
}

/** The hero row's map: beside the chart, 5 of 12 columns, 4 of 12 on a wide screen. */
function heroMap(): { width: number; height: number } {
  const share = window.innerWidth >= WIDE ? 4 / 12 : 5 / 12;
  return {
    width: (contentWidth() - GAP) * share,
    height: Math.min(520, Math.max(360, window.innerHeight * 0.42)),
  };
}

/** A static copy of a part, for a state the page shows only one at a time (a tab's panel). */
function copy(selector: string): HTMLElement {
  return take(selector).cloneNode(true) as HTMLElement;
}

/** Shows only the lanes named, by pressing the chips of the others. */
async function lanes(keep: string[]): Promise<void> {
  for (const chip of document.querySelectorAll<HTMLButtonElement>('#activity-page .ui-chip')) {
    const name = chip.textContent?.replace('✓', '').trim() ?? '';
    if (!keep.includes(name) && chip.getAttribute('aria-pressed') === 'true') chip.click();
  }
  await wait(300);
}

async function tabPanel(tab: string, panel: string): Promise<HTMLElement | null> {
  const button = document.querySelector<HTMLElement>(tab);
  if (!button) return null;
  button.click();
  await drawn(panel);
  await wait(200);
  return copy(panel);
}

const activity: Arrangement = async () => {
  const wide = window.innerWidth >= WIDE;
  const width = wide ? (contentWidth() - 2 * GAP) * 0.26 : (contentWidth() - GAP) * 0.35;
  await preframe(
    '#activity-map',
    { width, height: wide ? width : (width * 5) / 4 },
    location.hash,
    () =>
      document.querySelectorAll('#activity-summary dt').length > 3 &&
      document.querySelectorAll('#activity-lanes .lane').length > 2
  );
  const header = take('#activity-header');
  const actions = take('.ui-detail-actions', header);
  actions.replaceChildren(
    byText('#activity-header .ui-button', 'Create section'),
    byText('#activity-header .ui-button', 'Open on intervals.icu'),
    menu(['Export GPX', 'Compare with the last three on this route', 'Manage this activity'])
  );
  const summary = take('#activity-summary');
  const tiles = h(
    'div',
    { class: 'mock-key-figures' },
    tile('Distance', figure('Distance', summary)),
    tile('Moving time', figure('Moving time', summary)),
    tile('Climbing', figure('Climbing', summary)),
    tile('Average power', figure('Average power', summary)),
    tile('Average heart rate', figure('Average heart rate', summary)),
    tile('Load', figure('Training load', summary), `form ${figure('Form', summary)}`)
  );
  const allFigures = table(
    [{ label: 'Figure' }, { label: 'Value', numeric: true }],
    [...summary.querySelectorAll('dl > div')].map((pair) => [
      pair.querySelector('dt')?.textContent ?? '',
      pair.querySelector('dd')?.textContent ?? '',
    ])
  );
  const standing = await tabPanel('#tab-route', '#panel-route');
  const sections = await tabPanel('#tab-sections', '#panel-sections');
  const intervals = await tabPanel('#tab-intervals', '#panel-intervals');
  const zones = await tabPanel('#tab-zones', '#panel-zones');
  await lanes(['Elevation', 'Power', 'Heart rate', 'Speed']);
  const charts = take('#activity-lanes').closest('.ui-card') as HTMLElement;
  const map = take('#activity-map');

  const compared = card(
    'Against your other rides of this route',
    standing,
    h('div', { class: 'mock-row' }, button('Compare with the last three', 'secondary'))
  );
  const crossed = card('Sections on this ride', sections);
  const settings = manage('Gruyère ramble', [
    { label: 'Show on the heatmap', on: true },
    { group: 'Counted in its routes' },
    { label: 'Vineyard Circuit', note: 'Leave out to drop this ride from the route', on: true },
    { group: 'Counted in its sections' },
    { label: 'Vineyard Climb', on: true },
    { label: 'Col approach', on: true },
  ]);
  await mount(
    page(
      'mock-activity',
      header,
      grid(
        'mock-activity-grid',
        h('div', { class: 'mock-column mock-sticky' }, map, tiles),
        h('div', { class: 'mock-column' }, charts, compared),
        h('div', { class: 'mock-column mock-rail' }, crossed, settings)
      ),
      grid(
        'mock-activity-below',
        card('Intervals', intervals),
        card('Zones', zones),
        card('All figures', allFigures)
      )
    )
  );
};

/** A detail header in the kit's shape: what the item is, then at most two actions and the menu. */
function detailHeader(
  meta: string,
  note: string | null,
  actions: HTMLElement[],
  items: string[],
  extra?: HTMLElement
): HTMLElement {
  return h(
    'header',
    { class: 'ui-detail-header' },
    h(
      'div',
      { class: 'ui-detail-meta' },
      h('p', {}, meta),
      extra ?? null,
      note ? h('p', { class: 'ui-detail-note' }, note) : null
    ),
    h('div', { class: 'ui-detail-actions', role: 'group' }, ...actions, menu(items))
  );
}

/**
 * Replaces a kit table's count line with the bulk bar of a selection of `rows`. A toolbar that
 * holds the list's filter keeps it, and only the bulk actions are put in beside it.
 */
function selectWithBar(frame: HTMLElement, rows: number[], noun: string, actions: string[]): void {
  selectRows(frame, rows);
  const bar = frame.querySelector('.ui-table-bar');
  const bulk = bulkBar(rows.length, noun, actions);
  const filter = bar?.querySelector('.ui-list-filter');
  const actionsBar = bulk.querySelector('.ui-table-bulk');
  if (filter && actionsBar) {
    bar?.querySelector('.ui-table-bulk')?.remove();
    filter.after(actionsBar);
  } else if (bar) bar.replaceWith(bulk);
  else frame.prepend(bulk);
}

/** A view switch in the kit's segmented control, `on` pressed. */
function views(labels: string[], on: string): HTMLElement {
  return h(
    'div',
    { class: 'ui-segmented', role: 'group' },
    ...labels.map((label) => h('button', { type: 'button', 'aria-pressed': label === on }, label))
  );
}

/** A card whose header carries actions beside its title. */
function titled(
  title: string,
  actions: HTMLElement | null,
  ...children: (Node | null)[]
): HTMLElement {
  return h(
    'section',
    { class: 'ui-card' },
    h(
      'header',
      { class: 'ui-card-header' },
      h('h2', {}, title),
      actions ? h('div', { class: 'ui-card-actions' }, actions) : null
    ),
    ...children
  );
}

const activities: Arrangement = async () => {
  const tiles = [...document.querySelectorAll('#summary .ui-stat-tile')];
  const read = (at: number) => {
    const value = tiles[at]?.querySelector('.ui-stat-value')?.textContent ?? '';
    const [main, rest] = value.split(' · ');
    return { main: main ?? '', rest: rest ?? '' };
  };
  const week = read(0);
  const last = read(1);
  const fitness = read(2);
  const form = read(3);
  const summary = strip(
    tile('This week', week.main, week.rest),
    tile('Last week', last.main, last.rest),
    tile('Fitness', fitness.main),
    tile('Form', form.main)
  );
  const filters = take('#filters');
  const list = take('#feed-scroll');
  selectWithBar(take('.ui-table-frame', list), [1, 3, 4], 'activities', [
    'Compare',
    'Hide from heatmap',
    'Show on heatmap',
  ]);
  take('#detail-pane').remove();
  await mount(page('mock-activities', summary, filters, list));
};

/**
 * Selects attempts on the route page the way the athlete does, a click and then
 * Ctrl-clicks, so the map draws them: the route's own lines come from a
 * collection read and do not survive the map being moved.
 */
async function pickAttempts(rows: number[]): Promise<void> {
  const all = [
    ...document.querySelectorAll<HTMLTableRowElement>('#route-attempts tbody tr[data-row]'),
  ];
  rows.forEach((at, order) => {
    const row = all[at];
    const cell = row?.cells[2] ?? row;
    cell?.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: order > 0 }));
  });
  await wait(600);
}

const compare: Arrangement = async () => {
  await preframe('#map-slot', heroMap(), location.hash, routeReady);
  await pickAttempts([0, 1, 2]);
  const deltaTab = document.querySelector<HTMLElement>('#tab-delta');
  deltaTab?.click();
  await wait(800);
  const chart = take('#routes-detail .ui-tabs [role="tabpanel"], #panel-delta');
  const rows = [
    ...document.querySelectorAll<HTMLTableRowElement>('#route-attempts tbody tr'),
  ].slice(0, 3);
  const heads = [...document.querySelectorAll('#route-attempts thead th')].map(
    (th) => th.textContent?.replace(/[↕▼▲]/g, '').trim() ?? ''
  );
  const data = (cells: HTMLTableCellElement[]) =>
    cells.filter((cell) => !cell.hasAttribute('data-box'));
  const kept = heads.filter(
    (_, at) => !document.querySelectorAll('#route-attempts thead th')[at]?.hasAttribute('data-box')
  );
  const columns = kept.map((label, at) => ({ label, numeric: at > 0 }));
  const figures = table(
    columns,
    rows.map((row) => data([...row.cells]).map((cell) => cell.cloneNode(true) as Node))
  );
  const name = (
    document.querySelector<HTMLInputElement>('#routes-detail form.rename input')?.value ?? ''
  ).trim();
  const swatches = h(
    'div',
    { class: 'mock-legend' },
    ...rows.map((row, at) =>
      h(
        'span',
        {},
        h('span', { class: 'mock-swatch', 'data-at': at }),
        row.cells[1]?.textContent?.trim() ?? ''
      )
    )
  );
  const map = take('#map-slot');
  await mount(
    page(
      'mock-compare',
      detailHeader(
        `Comparing 3 attempts of ${name}`,
        'Best in each row marked',
        [button('Add from the list'), button('Close')],
        ['Export the figures'],
        swatches
      ),
      grid(
        'mock-hero',
        map,
        titled(
          'Ahead or behind the best',
          views(['Series', 'Ahead or behind'], 'Ahead or behind'),
          chart
        )
      ),
      card('Figures', figures)
    )
  );
};

const mapPage: Arrangement = async () => {
  byText('button', 'Fit all activities').click();
  await wait(1500);
  document.querySelector('#map-bottom')?.classList.add('mock-hidden');
  document.querySelector('#map-timeline')?.classList.add('mock-hidden');
  const first = take('#map-list tbody tr');
  first.setAttribute('aria-selected', 'true');
  const name =
    first.querySelector('td:nth-child(2), td[data-primary]')?.textContent?.trim() ?? 'Activity';
  const selection = h(
    'aside',
    { class: 'map-panel mock-selection' },
    h('header', { class: 'ui-card-header' }, h('h2', {}, name), button('Open', 'primary')),
    h('p', { class: 'mock-note' }, first.querySelector('td')?.textContent?.trim() ?? ''),
    h(
      'div',
      { class: 'mock-key-figures' },
      ...[...first.cells]
        .slice(2, 6)
        .map((cell, at) =>
          tile(['Distance', 'Time', 'Climbing', 'Load'][at] ?? '', cell.textContent?.trim() ?? '')
        )
    ),
    h(
      'p',
      { class: 'mock-note' },
      'Enter or double-click opens the activity. The list keeps its place.'
    )
  );
  take('#map-screen').append(selection);
  await mount(null);
};

// The browse pages keep their own map where it is: a map these pages draw from
// the phone's collection reads loses its lines when it is moved.
const routes: Arrangement = async () => {
  const count = document.querySelector('#routes-list p.meta');
  if (count) count.textContent = 'All 6 routes';
  take('#routes-page').classList.add('mock-browse-page');
  await mount(null);
};

const routeReady = () =>
  document.querySelector('#route-attempts tbody tr[data-row]') !== null &&
  document.querySelector('#panel-time figure') !== null;

const route: Arrangement = async () => {
  await preframe('#map-slot', heroMap(), location.hash, routeReady);
  const detail = take('#routes-detail');
  const name = (detail.querySelector<HTMLInputElement>('form.rename input')?.value ?? '').trim();
  const facts = [...detail.querySelectorAll('dl.facts dt')].map(
    (dt) => `${dt.nextElementSibling?.textContent ?? ''} ${dt.textContent?.toLowerCase() ?? ''}`
  );
  await pickAttempts([0, 2, 3]);
  const chart = take('#panel-time');
  const attempts = take('#route-attempts').closest('.ui-table-frame') as HTMLElement;
  selectWithBar(attempts, [0, 2, 3], 'attempts', ['Compare', 'Leave out of this route']);
  const map = take('#map-slot');
  const settings = manage(name, [
    { label: 'Name', field: name },
    { group: 'Reference attempt' },
    {
      label: 'Your best, 2025-12-07',
      note: 'Ahead or behind is measured against it. You confirm a change.',
      action: 'Change',
    },
    { label: 'Use the best again', action: 'Reset' },
  ]);
  await mount(
    page(
      'mock-route',
      detailHeader(
        `Ride · ${facts.join(' · ')}`,
        'Grouped from your activities',
        [button('Compare selected', 'primary'), button('Open latest attempt')],
        ['Export GPX', 'Manage this route']
      ),
      grid(
        'mock-hero',
        map,
        titled('Over time', views(['Over time', 'Spread', 'Ahead or behind'], 'Over time'), chart)
      ),
      grid('mock-table-rail', attempts, settings)
    )
  );
};

const sections: Arrangement = async () => {
  const review = byText('.filter-bar .ui-button', 'Accept all (3 to review)');
  const waiting = strip(
    tile('To review', '3', 'detected, not yet accepted'),
    tile('Could merge', '1', 'Vineyard Climb with a neighbour'),
    tile('Removed', '1', 'kept for restoring')
  );
  const list = take('#sections-list');
  selectWithBar(take('.ui-table-frame', list), [3, 5], 'sections', ['Accept', 'Remove', 'Compare']);
  const screen = take('#sections-page');
  screen.classList.add('mock-browse-page');
  screen.before(grid('mock-review', waiting, review));
  await framed();
  await mount(null);
};

const section: Arrangement = async () => {
  await preframe(
    '#section-map',
    heroMap(),
    location.hash,
    () =>
      document.querySelector('#section-body .section-name') !== null &&
      document.querySelector('#panel-time figure') !== null
  );
  const laps = await tabPanel('#tab-laps', '#panel-laps');
  document.querySelector<HTMLElement>('#tab-time')?.click();
  await drawn('#panel-time figure');
  await wait(300);
  const body = take('#section-body');
  const facts = [...body.querySelectorAll('dl.section-facts dt')].map(
    (dt) => `${dt.nextElementSibling?.textContent ?? ''} ${dt.textContent?.toLowerCase() ?? ''}`
  );
  const stats = take('table.section-stats');
  const range = take('.section-controls .ui-segmented');
  const chart = take('#panel-time');
  const map = take('#section-map');
  const passes = laps ?? h('p', {}, '');
  const frame = passes.querySelector<HTMLElement>('.ui-table-frame') ?? passes;
  selectWithBar(frame, [0, 1], 'passes', [
    'Compare',
    'Leave out of this section',
    'Set as reference',
  ]);
  const settings = manage('Vineyard Climb', [
    { label: 'Name', field: 'Vineyard Climb' },
    { label: 'Accepted', note: 'Keeps it through every detection', on: false },
    { label: 'Lifted ground', note: 'A bridge or a deck the map does not show', on: false },
    { label: 'Shown', note: 'Off removes it from lists and maps', on: true },
    { group: 'Reference pass' },
    { label: 'Your best, 4:43', note: 'You confirm a change', action: 'Change' },
  ]);
  await mount(
    page(
      'mock-section',
      detailHeader(
        `Ride · ${facts.join(' · ')}`,
        null,
        [button('Accept', 'primary'), button('Edit bounds')],
        ['Merge with a neighbour (1)', 'Export GPX', 'Manage this section'],
        badge('Detected')
      ),
      grid(
        'mock-hero',
        map,
        titled(
          'Over time',
          h(
            'div',
            { class: 'mock-row' },
            range,
            views(['Over time', 'Spread', 'Ahead or behind'], 'Over time')
          ),
          chart,
          stats
        )
      ),
      grid(
        'mock-table-rail',
        card(
          'Passes, best first',
          frame,
          h(
            'div',
            { class: 'ui-tablist mock-row' },
            h('button', { type: 'button' }, 'History'),
            h('button', { type: 'button' }, 'Merge (1)')
          )
        ),
        settings
      )
    )
  );
};

const fitness: Arrangement = async () => {
  document.querySelector<HTMLElement>('#tab-calendar')?.click();
  const comparisons = await drawn('#panel-screen-comparisons tbody tr');
  const held = comparisons.closest<HTMLElement>('.ui-card');
  if (!held) throw new Error('Week and season is not drawn in a card');
  const season = held.cloneNode(true) as HTMLElement;
  document.querySelector<HTMLElement>('#tab-overview')?.click();
  await drawn('#fitness-tiles');
  await drawn('#panel-wellness-lanes figure');
  await wait(1200);
  const tiles = [...document.querySelectorAll('#fitness-tiles li')].map((li) =>
    tile(
      li.querySelector('[data-part="label"]')?.textContent ?? '',
      li.querySelector('[data-part="value"]')?.textContent ?? ''
    )
  );
  const toolbar = take('#fitness-page .toolbar');
  const tabs = take('#fitness-page .ui-tablist');
  const cardOf = (panel: string) => take(panel).closest<HTMLElement>('.ui-card');
  await mount(
    page(
      'mock-fitness',
      grid('mock-fitness-top', toolbar, tabs),
      strip(...tiles),
      grid(
        'mock-timeline',
        h(
          'div',
          { class: 'mock-column' },
          cardOf('#panel-wellness-chart'),
          cardOf('#panel-wellness-lanes')
        ),
        h('div', { class: 'mock-column' }, season)
      )
    )
  );
};

const insights: Arrangement = async () => {
  const cards = [...document.querySelectorAll<HTMLElement>('#insight-cards > section')];
  for (const each of cards) each.classList.add('ui-card');
  const planned = [...document.querySelectorAll<HTMLElement>('#insights-page section.panel')].find(
    (panel) => panel.querySelector('h3')?.textContent?.startsWith('Planned')
  );
  const recent = [...document.querySelectorAll<HTMLElement>('#insights-page section.panel')].find(
    (panel) => panel.querySelector('h3')?.textContent === 'Recent records'
  );
  const kinds = take('#insights-kinds');
  await mount(
    page('mock-insights', kinds, grid('mock-cards', ...cards, planned ?? null, recent ?? null))
  );
};

const strength: Arrangement = async () => {
  const toolbar = take('.strength-toolbar');
  const overview = [...document.querySelectorAll<HTMLElement>('.strength-overview > .ui-card')];
  const [figureCard, balance, progression] = overview;
  const exercises = [...document.querySelectorAll<HTMLElement>('.strength-table')].find(
    (each) => each.querySelector('h2')?.textContent === 'Exercises'
  );
  const frame = exercises?.querySelector<HTMLElement>('.ui-table-frame');
  if (frame) selectWithBar(frame, [0, 1], 'exercises', ['Compare']);
  await mount(
    page(
      'mock-strength',
      toolbar,
      grid('mock-strength-top', figureCard ?? null, balance ?? null, progression ?? null),
      exercises ?? null
    )
  );
};

const exercise: Arrangement = async () => {
  const chart = take('#exercise-chart');
  const sessions = take('#exercise .ui-table-frame');
  const rows = [...sessions.querySelectorAll<HTMLTableRowElement>('tbody tr')];
  const latest = rows.at(-1)?.cells[2]?.textContent?.trim() ?? '';
  await mount(
    page(
      'mock-exercise',
      detailHeader(
        `Strength · ${rows.length} sessions · latest best set ${latest}`,
        null,
        [button('Add to a workout', 'primary'), button('Compare with')],
        ['Export sets']
      ),
      grid('mock-exercise-grid', card('Estimated one-rep best', chart), card('Sessions', sessions))
    )
  );
};

const workouts: Arrangement = async () => {
  const library = take('.workouts-library');
  const tables = [...library.querySelectorAll<HTMLElement>('.ui-table-frame')];
  const [saved, recent] = tables;
  if (saved) selectWithBar(saved, [1, 2], 'workouts', ['Delete', 'Compare muscle load']);
  await mount(
    page(
      'mock-workouts',
      detailHeader(
        '3 saved workouts · 3 recent sessions',
        null,
        [button('New workout', 'primary'), button('From a recent session')],
        []
      ),
      grid(
        'mock-two',
        titled('Saved workouts', null, saved ?? null),
        titled('Recent sessions', null, recent ?? null)
      )
    )
  );
};

const workout: Arrangement = async () => {
  const name = take('#workout-name') as HTMLInputElement;
  const exercises = take('#workout-exercises');
  const picker = take('#workout-picker').closest('.ui-table-frame') as HTMLElement;
  const field = h('input', {
    class: 'mock-field mock-name',
    value: name.value,
    'aria-label': 'Workout name',
  });
  await mount(
    page(
      'mock-workout',
      detailHeader(
        'Workout',
        null,
        [button('Save workout', 'primary'), button('Discard changes')],
        ['Duplicate', 'Delete workout'],
        field
      ),
      grid('mock-editor', exercises, titled('Add an exercise', null, picker))
    )
  );
};

const recordings: Arrangement = async () => {
  const list = take('#recordings-list');
  await mount(
    page(
      'mock-recordings',
      h(
        'p',
        { class: 'mock-note' },
        'Failed uploads first, then newest. A row opens its recording.'
      ),
      list
    )
  );
};

const recording: Arrangement = async () => {
  const stats = take('#recording-stats');
  const status = take('#recording-status');
  const tiles = [...stats.querySelectorAll('dt')].map((dt) =>
    tile(dt.textContent ?? '', dt.nextElementSibling?.textContent ?? '')
  );
  const facts = take('.detail-facts').textContent ?? '';
  await mount(
    page(
      'mock-recording',
      detailHeader(
        facts,
        null,
        [button('Open on intervals.icu', 'primary'), button('Compare with this route')],
        ['Export FIT']
      ),
      grid(
        'mock-activity-grid',
        h(
          'div',
          { class: 'mock-column' },
          card('Track', h('div', { class: 'mock-map-empty' }, 'The track on a framed map')),
          h('div', { class: 'mock-key-figures' }, ...tiles)
        ),
        h('div', { class: 'mock-column' }, card(null, status))
      )
    )
  );
};

const settings: Arrangement = async () => {
  const nav = take('#settings-list');
  const phone = [...nav.querySelectorAll<HTMLElement>('.settings-group')].find(
    (group) => group.querySelector('h2')?.textContent === 'On the phone'
  );
  phone?.replaceChildren(
    h(
      'p',
      { class: 'mock-note' },
      'Recording, sensors, notifications and widgets are set on the phone.'
    )
  );
  const pane = take('#settings-pane');
  await mount(page('mock-settings', grid('mock-settings-grid', nav, pane)));
};

export const ARRANGEMENTS: Record<string, Arrangement> = {
  activities,
  activity,
  compare,
  map: mapPage,
  routes,
  route,
  sections,
  section,
  fitness,
  insights,
  strength,
  exercise,
  workouts,
  workout,
  recordings,
  recording,
  settings,
};

/** Page-level layouts the arrangements name, kept beside them. */
export const LAYOUTS = `
.mock-column { display: flex; flex-direction: column; gap: var(--space-md); min-width: 0; }
.mock-row { display: flex; gap: var(--space-sm); padding-top: var(--space-sm); }
.mock-activity-grid { grid-template-columns: minmax(0, 35fr) minmax(0, 65fr); align-items: start; }
.mock-activity-grid .mock-rail { grid-column: 1 / -1; display: grid; grid-template-columns: 1fr 1fr; }
.mock-key-figures { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-sm); }
.mock-key-figures .mock-tile { flex-direction: column; align-items: flex-start; gap: 0; }
.mock-activity-below { grid-template-columns: repeat(3, minmax(0, 1fr)); align-items: start; }
.mock-activities #filters { display: flex; align-items: flex-end; gap: var(--space-sm-plus); }
.mock-activities .ui-table td, .mock-activities .ui-table th { height: var(--web-size-row); padding-top: 0; padding-bottom: 0; }
.mock-activities .feed-table .thumb { width: var(--space-lg); height: var(--space-lg); }
.mock-activities .ui-table td > a, .mock-activities .ui-table td[data-primary] { max-width: 360px; }
.mock-hero { grid-template-columns: minmax(0, 5fr) minmax(0, 7fr); height: clamp(360px, 42vh, 520px); align-items: start; }
.mock-hero > * { position: relative !important; top: auto !important; overflow: hidden; }
.mock-hero > .ui-card { height: 100%; }
.mock-hero .map-pane, .mock-hero .map-canvas { height: 100% !important; }
.mock-table-rail { grid-template-columns: minmax(0, 1fr) var(--web-layout-selection-panel); align-items: start; }
.mock-browse-grid { grid-template-columns: minmax(0, 45fr) minmax(0, 55fr); height: calc(100vh - var(--web-layout-topbar) - 3 * var(--space-md) - 72px); }
.mock-browse-grid > * { height: 100% !important; min-height: 0 !important; position: relative !important; top: auto !important; overflow: auto; }
.mock-browse-grid .map-pane, .mock-browse-grid .map-canvas { height: 100% !important; }
.mock-browse .pane { width: auto !important; }
.mock-review { grid-template-columns: minmax(0, 1fr) auto; align-items: center; margin-bottom: var(--space-md); }
.mock-browse-page .filter-bar { display: flex; flex-wrap: wrap; gap: var(--space-sm); align-items: flex-end; }
.mock-fitness-top { grid-template-columns: auto 1fr; align-items: center; }
.mock-fitness-top .toolbar { display: flex; gap: var(--space-sm-plus); }
.mock-timeline { grid-template-columns: minmax(0, 8fr) minmax(0, 4fr); align-items: start; }
.mock-cards { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); align-items: stretch; }
.mock-strength-top { grid-template-columns: minmax(0, 5fr) minmax(0, 3fr) minmax(0, 4fr); align-items: start; }
.mock-exercise-grid { grid-template-columns: minmax(0, 7fr) minmax(0, 5fr); align-items: start; }
.mock-two { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); align-items: start; }
.mock-editor { grid-template-columns: minmax(0, 1fr) var(--web-layout-list-pane); align-items: start; }
.mock-editor #workout-exercises { display: grid; grid-template-columns: repeat(auto-fill, minmax(560px, 1fr)); gap: var(--space-md); }
.mock-name { max-width: 480px; }
.mock-settings-grid { grid-template-columns: var(--web-layout-sidebar) minmax(0, var(--web-layout-form-max)); align-items: start; }
.mock-map-empty { display: grid; place-items: center; aspect-ratio: 4 / 3; background: var(--colour-map-land); color: var(--colour-text-secondary); border-radius: var(--web-radius-md); }
.mock-selection { position: absolute; top: var(--space-sm-plus); left: calc(var(--space-sm-plus) * 2 + 380px); width: var(--web-layout-selection-panel); display: flex; flex-direction: column; gap: var(--space-sm); padding: var(--space-md); }
.mock-recordings #recordings-list { max-width: 1400px; }
@media (min-width: 2200px) {
  .mock-hero { grid-template-columns: minmax(0, 4fr) minmax(0, 8fr); }
  .mock-editor #workout-exercises { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .mock-activity-grid { grid-template-columns: minmax(0, 26fr) minmax(0, 48fr) minmax(0, 26fr); }
  .mock-activity-grid .mock-rail { grid-column: auto; display: flex; }
}
`;

/** The reason a drawn mock-up is wrong, or null when it holds what its arrangement set out to draw. */
type Check = (shot: string) => Promise<string | null>;

/** The least share of a map's pixels that its lines must change from the ground. */
const MAP_INK = 0.01;

/** The attribution a map writes along its top edge, which is not its drawing. */
const ATTRIBUTION_STRIP = 40;

const CHECKS: Record<string, Check> = {
  fitness: async () => {
    const figures = [...document.querySelectorAll('.mock-strip .mock-tile-value')];
    if (figures.length < 3 || figures.some((each) => !each.textContent?.trim())) {
      return 'a Fitness tile holds no figure';
    }
    const charts = [...document.querySelectorAll('.mock-timeline svg')].filter(
      (each) => each.getBoundingClientRect().width > 0
    );
    if (charts.length < 2) return 'the Fitness timeline holds fewer than two drawn charts';
    if (!document.querySelector('.mock-timeline .ui-table tbody tr')) {
      return 'Week and season holds no rows beside the timeline';
    }
    return null;
  },
  sections: async (shot) => {
    const canvas = document.querySelector('#sections-map canvas.maplibregl-canvas');
    if (!canvas) return 'the Sections page has no map canvas';
    const ink = await inkShare(shot, canvas.getBoundingClientRect(), ATTRIBUTION_STRIP);
    return ink >= MAP_INK ? null : 'the Sections map draws no section lines';
  },
};

declare global {
  interface Window {
    mockCheck: (name: string, shot: string) => Promise<string | null>;
    mockRun: (name: string) => void;
    mockDone?: boolean;
    mockError?: string;
  }
}

window.mockCheck = async (name, shot) => (await CHECKS[name]?.(shot)) ?? null;

window.mockRun = (name: string) => {
  addStyles(STYLES + LAYOUTS);
  const arrangement = ARRANGEMENTS[name];
  if (!arrangement) {
    window.mockError = `no arrangement named ${name}`;
    return;
  }
  arrangement().then(
    () => {
      window.mockDone = true;
    },
    (error: Error) => {
      window.mockError = error.message;
    }
  );
};
