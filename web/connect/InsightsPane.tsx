// The insights page: on the left the cards the phone's own insights list
// shows, made by the same generators from the phone's reply, each with the
// method it carries and its series drawn at width; on the right the ranked
// sections, route records and recent records as tables. A row opens its
// section or route in a pane without leaving the page.

import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import type { InsightHistory } from '@/features/insights/types';

import { LineChart, clock } from './FitnessPane';
import {
  insightsOf,
  insightsSettings,
  type Insight,
  type InsightsParts,
  type InsightsReply,
} from './insights';

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

function Cards({ insights }: { insights: Insight[] }) {
  const { t } = useTranslation();
  return (
    <ul id="insight-cards" className="insight-cards">
      {insights.map((insight) => (
        <li key={insight.id} data-category={insight.category} data-priority={insight.priority}>
          <article className="panel card">
            <h3>{insight.title}</h3>
            {insight.subtitle ? <p className="subtitle">{insight.subtitle}</p> : null}
            <p className="line">{insight.line}</p>
            {insight.body ? <p className="body">{insight.body}</p> : null}
            <CardSeries insight={insight} />
            {insight.methodology ? (
              <details>
                <summary>{t('connectPage.insights.method')}</summary>
                <p>{insight.methodology.description}</p>
                {insight.methodology.formula ? (
                  <p>
                    <code>{insight.methodology.formula}</code>
                  </p>
                ) : null}
              </details>
            ) : null}
          </article>
        </li>
      ))}
    </ul>
  );
}

export type Opened = { kind: 'section' | 'route'; id: string } | null;

/** `section:ID` or `route:ID` as the address holds an opened row. */
export function parseOpened(text: string | null): Opened {
  const [kind, ...rest] = (text ?? '').split(':');
  const id = rest.join(':');
  return (kind === 'section' || kind === 'route') && id ? { kind, id } : null;
}

function Row({
  kind,
  id,
  opened,
  onOpen,
  cells,
}: {
  kind: 'section' | 'route';
  id: string;
  opened: Opened;
  onOpen: (key: string) => void;
  cells: ReactNode[];
}) {
  const on = opened?.kind === kind && opened.id === id;
  return (
    <tr
      className={on ? 'open' : undefined}
      tabIndex={0}
      onClick={() => onOpen(`${kind}:${id}`)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onOpen(`${kind}:${id}`);
      }}
    >
      {cells.map((cell, i) => (
        <td key={i}>{cell}</td>
      ))}
    </tr>
  );
}

function Tables({
  data,
  opened,
  onOpen,
}: {
  data: InsightsReply;
  opened: Opened;
  onOpen: (key: string) => void;
}) {
  const { t } = useTranslation();
  const sections = data.rankedSections.flatMap((group) =>
    group.sections.map((section) => ({ group: group.sportType, section }))
  );
  const head = (titles: string[]) => (
    <thead>
      <tr>
        {titles.map((title) => (
          <th key={title}>{title}</th>
        ))}
      </tr>
    </thead>
  );
  return (
    <>
      <section className="panel">
        <h3>{t('connectPage.insights.rankedSections')}</h3>
        <table id="ranked-sections">
          {head([
            t('connectPage.insights.colSection'),
            t('connectPage.fitness.sport'),
            t('connectPage.fitness.effortBest'),
            t('connectPage.insights.colVisits'),
          ])}
          <tbody>
            {sections.map(({ group, section }) => (
              <Row
                key={`${group}-${section.sectionId}`}
                kind="section"
                id={section.sectionId}
                opened={opened}
                onOpen={onOpen}
                cells={[
                  section.sectionName,
                  group,
                  clock(section.bestTimeSecs),
                  section.traversalCount,
                ]}
              />
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <h3>{t('connectPage.insights.routeRecords')}</h3>
        <table id="route-records">
          {head([
            t('connectPage.insights.colRoute'),
            t('connectPage.fitness.sport'),
            t('connectPage.fitness.effortBest'),
            t('connectPage.insights.colAttempts'),
          ])}
          <tbody>
            {data.routeInsights.map((route) => (
              <Row
                key={route.routeId}
                kind="route"
                id={route.routeId}
                opened={opened}
                onOpen={onOpen}
                cells={[
                  route.routeName,
                  route.sportType,
                  clock(route.bestTime),
                  route.attemptCount,
                ]}
              />
            ))}
          </tbody>
        </table>
      </section>
      <section className="panel">
        <h3>{t('connectPage.insights.recentRecords')}</h3>
        <table id="recent-records">
          {head([
            t('connectPage.insights.colSection'),
            t('connectPage.fitness.effortBest'),
            t('connectPage.insights.colDaysAgo'),
          ])}
          <tbody>
            {data.recentPrs.map((pr) => (
              <Row
                key={pr.sectionId}
                kind="section"
                id={pr.sectionId}
                opened={opened}
                onOpen={onOpen}
                cells={[pr.sectionName, clock(pr.bestTime), pr.daysAgo]}
              />
            ))}
          </tbody>
        </table>
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
      <button type="button" onClick={onClose}>
        {t('connectPage.fitness.close')}
      </button>
    </section>
  );
}

export function InsightsPane({
  parts,
  opened,
  onOpen,
}: {
  parts: InsightsParts | undefined;
  opened: Opened;
  onOpen: (key: string | null) => void;
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
  return (
    <section id="insights-page">
      <div className="toolbar">
        <h2>{t('connectPage.screens.insights')}</h2>
        <nav id="insights-kinds" aria-label={t('connectPage.screens.insights')}>
          <a href="#/insights?type=strength">{t('connectPage.insights.strength')}</a>
        </nav>
      </div>
      {data === undefined ? (
        <p id="insights-waiting" role="status">
          {t('connectPage.insights.waiting')}
        </p>
      ) : (
        <div className="columns">
          <div className="column charts">
            {failed ? (
              <p id="insights-failed" role="status">
                {t('connectPage.insights.failed')}
              </p>
            ) : insights.length === 0 ? (
              <p id="insights-empty">{t('connectPage.insights.empty')}</p>
            ) : (
              <Cards insights={insights} />
            )}
          </div>
          <div className="column tables">
            <OpenedPane opened={opened} onClose={() => onOpen(null)} />
            <Tables data={data} opened={opened} onOpen={onOpen} />
          </div>
        </div>
      )}
    </section>
  );
}
