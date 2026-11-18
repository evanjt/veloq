// The insights page: a strip for today, the planned events of the coming
// fortnight, a grid of the cards the phone's own insights list shows (made by
// the same generators from the phone's reply, grouped by category), and the
// ranked sections, route records and recent records as tables. A card opens in
// a drawer beside the grid with its history, supporting data and method; a
// table row opens its section or route in a pane without leaving the page.

import { Button, PageGrid } from '../ui';
import type { ReadError } from '../query';
import { ReadNotice } from '../shell/StatePanes';
import { DataTable } from '../ui/DataTable';
import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { InsightHistory } from '@/features/insights/types';

import { LineChart, clock } from './FitnessPane';
import type { Route } from '../router';
import { useTableLabels } from '../tableLabels';
import {
  nextOrder,
  orderRows,
  readTableOrder,
  sortProp,
  writeTableOrder,
  type Ordering,
} from '../tableOrder';
import { eventsOn, groupByCategory, hasHistory, type PlannedEvent } from '../insightsPage';
import {
  insightsOf,
  insightsSettings,
  type Insight,
  type InsightsParts,
  type InsightsReply,
} from '../insights';

const dayLabel = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

/** The series a card's history draws, or none for a map line or a card without one. */
function seriesOf(history: InsightHistory | undefined) {
  if (!history || !('series' in history)) return [];
  return history.series.filter((series) => series.points.length > 1);
}

/** A card's series over its own dates, every series on the dates of the longest. */
function CardSeries({ insight }: { insight: Insight }) {
  const series = seriesOf(insight.supportingData?.history);
  const longest = series.reduce<(typeof series)[number] | undefined>(
    (held, each) => (held && held.points.length >= each.points.length ? held : each),
    undefined
  );
  if (!longest) return null;
  const printed = (value: number) => {
    const text = longest.format ? longest.format(value) : String(Math.round(value * 100) / 100);
    return longest.unit ? `${text} ${longest.unit}` : text;
  };
  return (
    <LineChart
      labels={longest.points.map((point) => dayLabel(point.date))}
      lines={series.map((each, n) => ({
        className: n === 0 ? 'line-a' : 'line-b',
        values: longest.points.map((_, at) => each.points[at]?.value ?? null),
      }))}
      names={series.map((each) => each.label)}
      format={printed}
    />
  );
}

/** One card in the grid: its claim, and a button that opens it in the drawer. */
function CardTile({
  insight,
  open,
  onOpenCard,
}: {
  insight: Insight;
  open: boolean;
  onOpenCard: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <li data-category={insight.category} data-priority={insight.priority}>
      <article
        className="panel card ui-card"
        data-history={hasHistory(insight) || undefined}
        data-open={open || undefined}
      >
        <h3>{insight.title}</h3>
        {insight.subtitle ? <p className="subtitle">{insight.subtitle}</p> : null}
        <p className="line">{insight.line}</p>
        <Button data-action="open" aria-expanded={open} onClick={() => onOpenCard(insight.id)}>
          {t('connectPage.insights.openCard')}
        </Button>
      </article>
    </li>
  );
}

function Cards({
  insights,
  openCard,
  onOpenCard,
}: {
  insights: Insight[];
  openCard: string | null;
  onOpenCard: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <PageGrid id="insight-cards" className="insight-cards">
      {groupByCategory(insights).map((group) => (
        <section key={group.category} data-group={group.category}>
          <h3>{t(`connectPage.insights.category.${group.category}` as never)}</h3>
          <ul>
            {group.insights.map((insight) => (
              <CardTile
                key={insight.id}
                insight={insight}
                open={insight.id === openCard}
                onOpenCard={onOpenCard}
              />
            ))}
          </ul>
        </section>
      ))}
    </PageGrid>
  );
}

/** The drawer beside the grid: one card's history, its figures and its method. */
function Drawer({ insight, onClose }: { insight: Insight; onClose: () => void }) {
  const { t } = useTranslation();
  const support = insight.supportingData;
  const points = [support?.hero, ...(support?.dataPoints ?? [])].filter(
    (point): point is NonNullable<typeof point> => point !== undefined
  );
  return (
    <aside id="insight-drawer" aria-label={insight.title}>
      <header>
        <h3>{insight.title}</h3>
        <Button data-action="close" onClick={onClose}>
          {t('connectPage.fitness.close')}
        </Button>
      </header>
      {insight.subtitle ? <p className="subtitle">{insight.subtitle}</p> : null}
      <p className="line">{insight.line}</p>
      {insight.body ? <p className="body">{insight.body}</p> : null}
      <CardSeries insight={insight} />
      {points.length > 0 ? (
        <dl className="figures">
          {points.map((point, at) => (
            <div key={`${point.label}-${at}`}>
              <dt>{point.label}</dt>
              <dd>
                {point.value}
                {point.unit ? ` ${point.unit}` : ''}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {support?.sections?.length ? (
        <ul className="links">
          {support.sections.map((section) => (
            <li key={section.sectionId}>
              <a href={`#/section/${encodeURIComponent(section.sectionId)}`}>
                {section.sectionName}
              </a>
            </li>
          ))}
        </ul>
      ) : null}
      {support?.routes?.length ? (
        <ul className="links">
          {support.routes.map((route) => (
            <li key={route.rowKey}>
              <a href={`#/route/${encodeURIComponent(route.routeId)}`}>{route.routeName}</a>
            </li>
          ))}
        </ul>
      ) : null}
      {insight.methodology ? (
        <section className="method">
          <h4>{t('connectPage.insights.method')}</h4>
          <p>{insight.methodology.description}</p>
          {insight.methodology.formula ? (
            <p>
              <code>{insight.methodology.formula}</code>
            </p>
          ) : null}
        </section>
      ) : null}
    </aside>
  );
}

/** Today's form and the workouts planned for the day. */
export function TodayStrip({
  form,
  planned,
  today,
}: {
  form: InsightsReply['form'] | null | undefined;
  planned: PlannedEvent[] | undefined;
  today: string;
}) {
  const { t } = useTranslation();
  const todays = eventsOn(planned ?? [], today).filter((event) => event.category === 'workout');
  const round = (value: number) => String(Math.round(value));
  return (
    <section id="insights-today" className="panel" aria-label={t('connectPage.insights.today')}>
      <h3>{t('connectPage.insights.today')}</h3>
      <dl className="figures">
        {form ? (
          <>
            <div>
              <dt>{t('connectPage.insights.fitnessCtl')}</dt>
              <dd>{round(form.ctl)}</dd>
            </div>
            <div>
              <dt>{t('connectPage.insights.fatigueAtl')}</dt>
              <dd>{round(form.atl)}</dd>
            </div>
            <div>
              <dt>{t('connectPage.insights.formTsb')}</dt>
              <dd>
                {form.form === null ? '–' : `${round(form.form)}${form.formAsPercent ? '%' : ''}`}
              </dd>
            </div>
          </>
        ) : null}
        <div>
          <dt>{t('connectPage.insights.plannedToday')}</dt>
          <dd>
            {todays.length > 0
              ? todays.map((event) => event.name).join(', ')
              : t('connectPage.insights.nothingPlanned')}
          </dd>
        </div>
      </dl>
    </section>
  );
}

/** The calendar events of the coming fortnight, in the order the phone sent them. */
function PlannedEvents({ events }: { events: PlannedEvent[] }) {
  const { t } = useTranslation();
  const labels = useTableLabels();
  return (
    <section className="panel">
      <h3>{t('connectPage.insights.planned')}</h3>
      {events.length === 0 ? (
        <p id="planned-empty">{t('connectPage.insights.nothingPlannedAhead')}</p>
      ) : (
        <DataTable
          label={t('connectPage.insights.planned')}
          tableId="planned-events"
          labels={labels}
          columns={[
            {
              key: 'day',
              header: t('connectPage.insights.colDay'),
              cell: (e: PlannedEvent) => e.day,
            },
            {
              key: 'name',
              header: t('connectPage.insights.colEvent'),
              clip: true,
              cell: (e) => e.name,
            },
            { key: 'sport', header: t('connectPage.fitness.sport'), cell: (e) => e.sport },
            {
              key: 'time',
              header: t('connectPage.insights.colPlannedTime'),
              numeric: true,
              cell: (e) => (e.movingTime === null ? '' : clock(e.movingTime)),
            },
            {
              key: 'load',
              header: t('connectPage.insights.colLoad'),
              numeric: true,
              cell: (e) => (e.trainingLoad === null ? '' : Math.round(e.trainingLoad)),
            },
          ]}
          rows={events}
          rowKey={(e) => String(e.id)}
        />
      )}
    </section>
  );
}

export type Opened = { kind: 'section' | 'route'; id: string } | null;

/** `section:ID` or `route:ID` as the address holds an opened row. */
export function parseOpened(text: string | null): Opened {
  const [kind, ...rest] = (text ?? '').split(':');
  const id = rest.join(':');
  return (kind === 'section' || kind === 'route') && id ? { kind, id } : null;
}

type InsightRow = {
  kind: 'section' | 'route';
  id: string;
  cells: ReactNode[];
  /** What each cell orders by; null for a cell with no value. */
  values: (number | string | null)[];
};

/** The order the engine sent, which is the table's order until a head is clicked. */
const ENGINE_ORDER: Ordering<string> = { column: 'engine', descending: false };

/** One of the page's record tables; a row opens its section or route. */
function RecordTable({
  id,
  label,
  titles,
  rows,
  opened,
  onOpen,
  route,
  onRoute,
}: {
  id: string;
  label: string;
  titles: string[];
  rows: InsightRow[];
  opened: Opened;
  onOpen: (key: string) => void;
  route: Route;
  onRoute: (route: Route) => void;
}) {
  const labels = useTableLabels();
  const keys = titles.map((_, at) => String(at));
  const order = readTableOrder(route, id, ['engine', ...keys], ENGINE_ORDER);
  const shown = orderRows(
    rows.map((row, at) => ({ row, at })),
    order,
    ({ row, at }, column) => (column === 'engine' ? at : (row.values[Number(column)] ?? null))
  ).map(({ row }) => row);
  return (
    <DataTable
      label={label}
      tableId={id}
      labels={labels}
      columns={titles.map((title, at) => ({
        key: String(at),
        header: title,
        sortable: true,
        clip: at === 0,
        numeric: typeof rows[0]?.values[at] === 'number',
        cell: (row: InsightRow) => row.cells[at],
      }))}
      rows={shown}
      rowKey={(row) => `${row.kind}:${row.id}`}
      sort={sortProp(order)}
      onSort={(key) =>
        onRoute(
          writeTableOrder(
            route,
            id,
            nextOrder(order, key, typeof rows[0]?.values[Number(key)] === 'number'),
            ENGINE_ORDER
          )
        )
      }
      href={(row) => `#/${row.kind}/${encodeURIComponent(row.id)}`}
      selectedKey={opened ? `${opened.kind}:${opened.id}` : null}
      onRowClick={(row) => onOpen(`${row.kind}:${row.id}`)}
      onOpen={(row) => onOpen(`${row.kind}:${row.id}`)}
    />
  );
}

function Tables({
  data,
  opened,
  onOpen,
  route,
  onRoute,
}: {
  data: InsightsReply;
  opened: Opened;
  onOpen: (key: string) => void;
  route: Route;
  onRoute: (route: Route) => void;
}) {
  const { t } = useTranslation();
  const sections = data.rankedSections.flatMap((group) =>
    group.sections.map((section) => ({ group: group.sportType, section }))
  );
  return (
    <>
      <section className="panel">
        <h3>{t('connectPage.insights.rankedSections')}</h3>
        <RecordTable
          id="ranked-sections"
          label={t('connectPage.insights.rankedSections')}
          titles={[
            t('connectPage.insights.colSection'),
            t('connectPage.fitness.sport'),
            t('connectPage.fitness.effortBest'),
            t('connectPage.insights.colVisits'),
          ]}
          rows={sections.map(({ group, section }) => ({
            kind: 'section',
            id: section.sectionId,
            cells: [
              section.sectionName,
              group,
              clock(section.bestTimeSecs),
              section.traversalCount,
            ],
            values: [section.sectionName, group, section.bestTimeSecs, section.traversalCount],
          }))}
          opened={opened}
          onOpen={onOpen}
          route={route}
          onRoute={onRoute}
        />
      </section>
      <section className="panel">
        <h3>{t('connectPage.insights.routeRecords')}</h3>
        <RecordTable
          id="route-records"
          label={t('connectPage.insights.routeRecords')}
          titles={[
            t('connectPage.insights.colRoute'),
            t('connectPage.fitness.sport'),
            t('connectPage.fitness.effortBest'),
            t('connectPage.insights.colAttempts'),
          ]}
          rows={data.routeInsights.map((route) => ({
            kind: 'route',
            id: route.routeId,
            cells: [route.routeName, route.sportType, clock(route.bestTime), route.attemptCount],
            values: [route.routeName, route.sportType, route.bestTime, route.attemptCount],
          }))}
          opened={opened}
          onOpen={onOpen}
          route={route}
          onRoute={onRoute}
        />
      </section>
      <section className="panel">
        <h3>{t('connectPage.insights.recentRecords')}</h3>
        <RecordTable
          id="recent-records"
          label={t('connectPage.insights.recentRecords')}
          titles={[
            t('connectPage.insights.colSection'),
            t('connectPage.fitness.effortBest'),
            t('connectPage.insights.colDaysAgo'),
          ]}
          rows={data.recentPrs.map((pr) => ({
            kind: 'section',
            id: pr.sectionId,
            cells: [pr.sectionName, clock(pr.bestTime), pr.daysAgo],
            values: [pr.sectionName, pr.bestTime, pr.daysAgo],
          }))}
          opened={opened}
          onOpen={onOpen}
          route={route}
          onRoute={onRoute}
        />
      </section>
    </>
  );
}

function OpenedPane({ opened, onClose }: { opened: Opened; onClose: () => void }) {
  const { t } = useTranslation();
  if (!opened) return null;
  const section = opened.kind === 'section';
  return (
    <section id="detail-pane" className="panel" aria-label={t('connectPage.insights.openedRow')}>
      <h3>{section ? t('connectPage.insights.colSection') : t('connectPage.insights.colRoute')}</h3>
      <a href={`#/${opened.kind}/${encodeURIComponent(opened.id)}`}>
        {section ? t('connectPage.insights.openSection') : t('connectPage.insights.openRoute')}
      </a>{' '}
      <Button onClick={onClose}>{t('connectPage.fitness.close')}</Button>
    </section>
  );
}

export function InsightsPane({
  parts,
  error,
  loading,
  onRetry,
  opened,
  onOpen,
  route,
  onRoute,
  openCard,
  onOpenCard,
  planned,
  today,
}: {
  parts: InsightsParts | undefined;
  /** Why the bundle has no answer, with none held. */
  error?: ReadError | null;
  loading?: boolean;
  onRetry?: (() => void) | undefined;
  opened: Opened;
  onOpen: (key: string | null) => void;
  route: Route;
  onRoute: (route: Route) => void;
  /** The id of the card open in the drawer. */
  openCard: string | null;
  onOpenCard: (id: string | null) => void;
  /** The planned events of the coming fortnight, once the phone has answered. */
  planned: PlannedEvent[] | undefined;
  today: string;
}) {
  const { t, i18n } = useTranslation();
  const settings = useMemo(
    () => insightsSettings(parts?.settings, i18n.language),
    [parts?.settings, i18n.language]
  );
  const { insights, failed } = useMemo(
    () =>
      insightsOf(parts?.data, settings, (key, params) => String(t(key as never, params as never))),
    [parts?.data, settings, t]
  );
  const data = parts?.data;
  const openInsight = insights.find((each) => each.id === openCard);
  return (
    <section id="insights-page">
      <div className="toolbar">
        <nav id="insights-kinds" aria-label={t('connectPage.screens.insights')}>
          <a href="#/insights?type=strength">{t('connectPage.insights.strength')}</a>
        </nav>
      </div>
      {data === undefined ? (
        error ? (
          <ReadNotice error={error} onRetry={onRetry} />
        ) : loading === false ? null : (
          <p id="insights-waiting" role="status">
            {t('connectPage.insights.waiting')}
          </p>
        )
      ) : (
        <>
          <div className="today-row">
            <TodayStrip form={data.form} planned={planned} today={today} />
            <PlannedEvents events={planned ?? []} />
          </div>
          <div className={openInsight ? 'cards-row with-drawer' : 'cards-row'}>
            {failed ? (
              <p id="insights-failed" role="status">
                {t('connectPage.insights.failed')}
              </p>
            ) : insights.length === 0 ? (
              <p id="insights-empty">{t('connectPage.insights.empty')}</p>
            ) : (
              <Cards
                insights={insights}
                openCard={openInsight?.id ?? null}
                onOpenCard={(id) => onOpenCard(id === openInsight?.id ? null : id)}
              />
            )}
            {openInsight ? <Drawer insight={openInsight} onClose={() => onOpenCard(null)} /> : null}
          </div>
          <div className="tables">
            <OpenedPane opened={opened} onClose={() => onOpen(null)} />
            <Tables data={data} opened={opened} onOpen={onOpen} route={route} onRoute={onRoute} />
          </div>
        </>
      )}
    </section>
  );
}
