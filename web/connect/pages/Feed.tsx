// The activities page: a summary strip, one filter bar, the table of every
// activity and a pane that previews the one pointed at, or compares the ones
// selected. The range, sports, sort, selection and comparison live in the hash.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ParseKeys } from 'i18next';
import { useTranslation } from 'react-i18next';

import { compareColour, compareRows, select, type Mode } from '../compare';
import { clock, km, kmh } from '../format';
import type { FeedFilter, SportFamily } from '../link';
import { sportMark, THUMB, trackShape } from '../preview';
import { go, keyAction, queryValue, type Route } from '../router';
import { registerShortcuts } from '../shortcuts';
import { useDetails, useFeed, type Card, type Detail, type Sparklines, type Summary } from '../feedReads';
import { ReadNotice } from '../shell/StatePanes';
import type { Read } from '../useRead';
import { SportGlyph } from '../SportGlyph';
import {
  COLUMNS,
  RANGES,
  RANGE_LABELS,
  columnsForWidth,
  feedQuery,
  rangeBounds,
  readFeedQuery,
  selectionAfter,
  sortRows,
  type ColumnKey,
  type FeedQuery,
  type RangePreset,
  type Sort,
} from '../table';
import {
  Badge,
  Button,
  Card as Surface,
  Chip,
  ChipGroup,
  DataTable,
  EmptyState,
  SearchField,
  SegmentedControl,
  type Column,
} from '../ui';
import { useTableLabels } from '../tableLabels';
import type { PageProps } from './types';

const FAMILIES: [family: SportFamily, label: ParseKeys][] = [
  ['ride', 'connectPage.families.ride'],
  ['run', 'connectPage.families.run'],
  ['winter', 'connectPage.families.winter'],
  ['water', 'connectPage.families.water'],
  ['foot', 'connectPage.families.foot'],
  ['strength', 'connectPage.families.strength'],
  ['other', 'connectPage.families.other'],
];

/** How long typing pauses before the search is asked of the phone. */
const SEARCH_PAUSE_MS = 250;

/** How long the pointer rests on a row before the detail pane previews it. */
const PREVIEW_DELAY_MS = 300;

/** True when a key press landed on something that handles Enter itself. */
function isControl(target: EventTarget | null) {
  const tag = (target as HTMLElement | null)?.tagName?.toUpperCase();
  return tag === 'BUTTON' || tag === 'A';
}

export function FeedPage({ route }: PageProps) {
  const [search, setSearch] = useState('');
  const [needle, setNeedle] = useState('');
  const [previewId, setPreviewId] = useState<string | null>(null);
  const feedState = readFeedQuery(route);
  const familiesKey = feedState.families.join(',');
  const shownId = previewId ?? queryValue(route, 'id');

  const filter = useMemo<FeedFilter>(() => {
    const { oldestTs, newestTs } = rangeBounds(feedState.range, new Date());
    const families = familiesKey ? (familiesKey.split(',') as SportFamily[]) : [];
    return { families, needle, oldestTs, newestTs };
  }, [familiesKey, feedState.range, needle]);
  const feed = useFeed(filter);
  const details = useDetails([...(shownId ? [shownId] : []), ...feedState.ids]);

  const typed = search.trim();
  useEffect(() => {
    if (typed === needle) return undefined;
    const typing = setTimeout(() => setNeedle(typed), SEARCH_PAUSE_MS);
    return () => clearTimeout(typing);
  }, [typed, needle]);

  const cards = useRef(feed.cards);
  useEffect(() => {
    cards.current = feed.cards;
  }, [feed.cards]);
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const action = keyAction({
        key: event.key,
        target: event.target as HTMLElement | null,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
      });
      if (action?.do !== 'step' && action?.do !== 'open') return;
      const query = readFeedQuery(route);
      if (action.do === 'step') {
        const ids = sortRows(cards.current, query.sort).map((row) => row.id);
        const id = selectionAfter(ids, query.id, action.step);
        if (id === null) return;
        event.preventDefault();
        go({ ...route, query: feedQuery({ ...query, id, ids: [] }) });
        document
          .querySelector(`[data-row="${CSS.escape(id)}"]`)
          ?.scrollIntoView?.({ block: 'nearest' });
      } else if (query.id && !isControl(event.target)) {
        event.preventDefault();
        go({ screen: 'activity', id: query.id, query: [] });
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [route]);
  useEffect(
    () =>
      registerShortcuts([
        { keys: ['j', 'k'], label: 'connectPage.keys.step', group: 'page' },
        { keys: ['Enter'], label: 'connectPage.keys.open', group: 'page' },
      ]),
    []
  );

  return (
    <Library
      cards={feed.cards}
      more={feed.more}
      first={feed.first}
      summary={feed.summary}
      familyCounts={feed.familyCounts}
      sparklines={feed.sparklines.data ?? null}
      highlights={feed.highlights}
      previews={feed.previews}
      onMore={feed.loadMore}
      detail={shownId ? details[shownId] : undefined}
      shownId={shownId}
      route={route}
      query={feedState}
      search={search}
      onSearch={setSearch}
      onPreview={setPreviewId}
      details={details}
    />
  );
}

function Library(props: {
  cards: Card[];
  more: boolean;
  first: Read<unknown>;
  summary: Read<Summary>;
  familyCounts: Readonly<Partial<Record<string, number>>>;
  sparklines: Sparklines | null;
  highlights: Readonly<Record<string, string[]>>;
  previews: Readonly<Record<string, string>>;
  onMore: () => void;
  detail: Detail | undefined;
  shownId: string | null;
  route: Route;
  query: FeedQuery;
  search: string;
  onSearch: (value: string) => void;
  onPreview: (id: string | null) => void;
  details: Readonly<Record<string, Detail | undefined>>;
}) {
  const { t } = useTranslation();
  const [dropped, setDropped] = useState<string[]>([]);
  const compared = props.query.ids
    .map((id) => props.cards.find((row) => row.id === id))
    .filter((row): row is Card => row !== undefined);
  const comparing = compared.length >= 2;
  const card = props.cards.find((row) => row.id === props.shownId);
  const rows = sortRows(props.cards, props.query.sort);
  return (
    <section id="library">
      {props.summary.data ? (
        <SummaryStrip card={props.summary.data} lines={props.sparklines} />
      ) : props.summary.error && !props.first.error ? (
        <ReadNotice error={props.summary.error} onRetry={props.summary.retry} />
      ) : null}
      <FilterBar query={props.query} counts={props.familyCounts} search={props.search} onSearch={props.onSearch} />
      <div id="list-pane">
        {props.query.sort && props.more ? (
          <p id="sort-note" role="note">
            {t('connectPage.library.sortNote', { count: props.cards.length })}
          </p>
        ) : null}
        {props.first.error && props.cards.length === 0 ? (
          <ReadNotice error={props.first.error} onRetry={props.first.retry} />
        ) : null}
        <FeedTable
          rows={rows}
          highlights={props.highlights}
          previews={props.previews}
          query={props.query}
          onPreview={props.onPreview}
          onDropped={setDropped}
        />
        {props.more ? <MoreButton onMore={props.onMore} /> : null}
      </div>
      <aside id="detail-pane" aria-label={t('connectPage.library.detailLabel')}>
        {comparing ? (
          <CompareTable
            cards={compared}
            details={props.details}
            dropped={props.cards.filter((row) => dropped.includes(row.id)).map((row) => row.name)}
          />
        ) : card ? (
          <>
            <h3 id="detail-title" className="panel-title">
              {card.name}
            </h3>
            <DetailFacts card={card} detail={props.detail} />
            <a className="open-activity" href={`#/activity/${encodeURIComponent(card.id)}`}>
              {t('connectPage.library.open')}
            </a>
          </>
        ) : (
          <EmptyState title={t('connectPage.library.pick')} />
        )}
      </aside>
    </section>
  );
}

/** Point the feed at a state, keeping the screen. */
function goFeed(query: FeedQuery) {
  go({ screen: 'activities', id: null, query: feedQuery(query) });
}

/** The week's totals and the wellness headlines, as four tiles above the list. */
function SummaryStrip({ card, lines }: { card: Summary; lines: Sparklines | null }) {
  const { t } = useTranslation();
  const { wellness } = card;
  const whole = (value: number | null | undefined) =>
    value == null ? null : String(Math.round(value));
  const week = (total: Summary['currentWeek']) =>
    t('connectPage.weekTotal', { time: clock(total.totalDuration), count: total.count });
  const readings = [
    wellness.hrv == null ? null : `${t('connectPage.facts.hrv')} ${whole(wellness.hrv)}`,
    wellness.rhr == null ? null : `${t('connectPage.facts.restingHr')} ${whole(wellness.rhr)} bpm`,
  ].filter((reading): reading is string => reading !== null);
  const tiles: { key: string; label: string; value: string | null; note?: string }[] = [
    { key: 'thisWeek', label: t('connectPage.facts.thisWeek'), value: week(card.currentWeek) },
    { key: 'lastWeek', label: t('connectPage.facts.lastWeek'), value: week(card.prevWeek) },
    { key: 'fitness', label: t('connectPage.facts.fitness'), value: whole(wellness.fitness) },
    {
      key: 'form',
      label: t('connectPage.facts.form'),
      value: whole(wellness.form),
      note: readings.join(' · '),
    },
  ];
  return (
    <section id="summary" aria-label={t('connectPage.library.summary')}>
      {tiles.map((tile) => (
        <Surface key={tile.key} label={tile.label}>
          <p className="tile-label">{tile.label}</p>
          <p className="tile-value">{tile.value ?? '–'}</p>
          {tile.key === 'fitness' ? (
            <svg
              id="summary-spark"
              viewBox="0 0 120 32"
              role="img"
              aria-label={t('connectPage.library.fitnessTrend')}
            >
              <polyline
                id="summary-line"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                points={sparkPoints(lines?.fitness ?? [])}
              />
            </svg>
          ) : tile.note ? (
            <p className="tile-note">{tile.note}</p>
          ) : null}
        </Surface>
      ))}
    </section>
  );
}

/** An SVG polyline's points for a series, scaled into a 120 by 32 box. */
function sparkPoints(series: readonly number[]) {
  if (series.length < 2) return '';
  const low = Math.min(...series);
  const span = Math.max(...series) - low || 1;
  return series
    .map(
      (v, at) =>
        `${((at / (series.length - 1)) * 120).toFixed(1)},${(32 - ((v - low) / span) * 32).toFixed(1)}`
    )
    .join(' ');
}

/** The one filter bar: the range, the sport families and the search. */
function FilterBar({
  query,
  counts,
  search,
  onSearch,
}: {
  query: FeedQuery;
  counts: Readonly<Partial<Record<string, number>>>;
  search: string;
  onSearch: (value: string) => void;
}) {
  const { t } = useTranslation();
  const everything = 'all';
  return (
    <div id="filters" role="search">
      <SegmentedControl<RangePreset | typeof everything>
        label={t('connectPage.library.range')}
        value={query.range ?? everything}
        options={[
          { value: everything, label: t('connectPage.library.all') },
          ...RANGES.map((preset: RangePreset) => ({
            value: preset,
            label: t(RANGE_LABELS[preset]),
          })),
        ]}
        onChange={(value) => goFeed({ ...query, range: value === everything ? null : value })}
      />
      <ChipGroup label={t('connectPage.library.sportLabel')}>
        {FAMILIES.map(([family, label]) => {
          const on = query.families.includes(family);
          return (
            <Chip
              key={family}
              selected={on}
              onToggle={() =>
                goFeed({
                  ...query,
                  families: on
                    ? query.families.filter((held) => held !== family)
                    : [...query.families, family],
                })
              }
            >
              {t(label)}
              <span className="chip-count"> {counts[family] ?? 0}</span>
            </Chip>
          );
        })}
      </ChipGroup>
      <SearchField
        id="search"
        label={t('connectPage.library.searchLabel')}
        clearLabel={t('connectPage.library.clearSearch')}
        placeholder={t('connectPage.library.searchPlaceholder')}
        value={search}
        onChange={onSearch}
      />
    </div>
  );
}

/** Reads the next page when clicked or when it scrolls into view. */
function MoreButton({ onMore }: { onMore: () => void }) {
  const { t } = useTranslation();
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = anchor.current;
    if (!node || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver((seen) => {
      if (seen.some((entry) => entry.isIntersecting)) onMore();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [onMore]);
  return (
    <div ref={anchor} id="feed-more">
      <Button variant="secondary" onClick={onMore}>
        {t('connectPage.library.loadMore')}
      </Button>
    </div>
  );
}

/** The next sort when a header is pressed: ascending, descending, then none. */
function nextSort(sort: Sort | null, column: ColumnKey): Sort | null {
  if (sort?.column !== column) return { column, dir: 'asc' };
  return sort.dir === 'asc' ? { column, dir: 'desc' } : null;
}

const cell = (card: Card, key: ColumnKey): string | null => {
  switch (key) {
    case 'date':
      return String(card.startDateLocal ?? '').slice(0, 10) || null;
    case 'sport':
      return card.sportType ?? null;
    case 'distance':
      return km(card.distance);
    case 'time':
      return clock(card.movingTime);
    case 'load':
      return card.trainingLoad == null ? null : String(Math.round(card.trainingLoad));
    case 'climb':
      return card.elevationGain == null ? null : `${Math.round(card.elevationGain)} m`;
    case 'hr':
      return card.avgHr == null ? null : String(Math.round(card.avgHr));
    case 'power':
      return card.avgPower == null ? null : `${Math.round(card.avgPower)} W`;
    default:
      return card.name;
  }
};

/** The window's width, followed as it is resized. */
function useWindowWidth(): number {
  const [width, setWidth] = useState(window.innerWidth);
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return width;
}

function FeedTable({
  rows,
  highlights,
  previews,
  query,
  onPreview,
  onDropped,
}: {
  rows: Card[];
  highlights: Readonly<Record<string, string[]>>;
  previews: Readonly<Record<string, string>>;
  query: FeedQuery;
  onPreview: (id: string | null) => void;
  onDropped: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const labels = useTableLabels();
  const hover = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(hover.current);
      onPreview(null);
    },
    [onPreview]
  );
  const shown = columnsForWidth(useWindowWidth());
  const columns: Column<Card>[] = COLUMNS.filter((column) =>
    shown.includes(column.key)
  ).map((column) => ({
    key: column.key,
    header: t(column.label),
    numeric: column.numeric,
    sortable: true,
    clip: column.key === 'name',
    ...(column.key === 'name' ? { cellProps: (card: Card) => ({ title: card.name }) } : {}),
    cell: (card: Card) => {
      if (column.key === 'name') {
        return (
          <span className="feed-name">
            <Thumbnail card={card} preview={previews[card.id]} />
            <span className="feed-title">
              <span className="name">{card.name}</span>
              {highlights[card.id]?.length ? (
                <span className="feed-badges">
                  {(highlights[card.id] ?? []).map((label, at) => (
                    <Badge key={at}>{label}</Badge>
                  ))}
                </span>
              ) : null}
            </span>
          </span>
        );
      }
      if (column.key === 'sport') {
        const sport = sportMark(card.sportType);
        return <SportGlyph family={sport.family} label={card.sportType ?? ''} />;
      }
      return cell(card, column.key);
    },
  }));
  const selected = new Set([...(query.id ? [query.id] : []), ...query.ids]);
  return (
    <div id="feed-scroll" className="feed-table">
      <DataTable
        label={t('connectPage.library.activities')}
        tableId="feed"
        labels={labels}
        href={(card) => `#/activity/${encodeURIComponent(card.id)}`}
        columns={columns}
        rows={rows}
        rowKey={(card) => card.id}
        {...(query.sort ? { sort: { key: query.sort.column, direction: query.sort.dir } } : {})}
        onSort={(key) => goFeed({ ...query, sort: nextSort(query.sort, key as ColumnKey) })}
        onRowHover={(card) => {
          clearTimeout(hover.current);
          onPreview(null);
          if (card) hover.current = setTimeout(() => onPreview(card.id), PREVIEW_DELAY_MS);
        }}
        onRowClick={(card, event) => {
          clearTimeout(hover.current);
          onPreview(null);
          const mode: Mode = event.shiftKey
            ? 'range'
            : event.ctrlKey || event.metaKey
              ? 'toggle'
              : 'single';
          if (mode === 'single') {
            onDropped([]);
            goFeed({ ...query, id: card.id, ids: [] });
            return;
          }
          const next = select(
            { ids: query.ids, anchor: query.id ?? query.ids[0] ?? null },
            rows.map((row) => row.id),
            card.id,
            mode
          );
          onDropped(next.dropped);
          goFeed(
            next.ids.length >= 2
              ? { ...query, ids: next.ids, id: query.id ?? next.ids[0] ?? null }
              : { ...query, ids: [], id: next.ids[0] ?? query.id }
          );
        }}
        isSelected={(card) => selected.has(card.id)}
      />
    </div>
  );
}

/** The track as a static line, or the sport's mark where the card has no track. */
export function Thumbnail({ card, preview }: { card: Card; preview: string | undefined }) {
  const shape = card.hasGps && preview ? trackShape(preview) : null;
  const sport = sportMark(card.sportType);
  if (!shape) {
    return (
      <span className="thumb thumb-sport" data-sport={sport.family} aria-hidden="true">
        {sport.mark}
      </span>
    );
  }
  return (
    <svg
      className="thumb"
      data-sport={sport.family}
      viewBox={`0 0 ${THUMB} ${THUMB}`}
      aria-hidden="true"
    >
      <path d={shape.path} className="thumb-line" />
      <circle cx={shape.start[0]} cy={shape.start[1]} r="2.5" className="thumb-start" />
      <circle cx={shape.end[0]} cy={shape.end[1]} r="2.5" className="thumb-end" />
    </svg>
  );
}

/** One column per compared activity, the best value in each row marked. */
function CompareTable(props: {
  cards: Card[];
  details: Readonly<Record<string, Detail | undefined>>;
  dropped: string[];
}) {
  const { t } = useTranslation();
  const labels = useTableLabels();
  const rows = compareRows(props.cards, props.details);
  const columns: Column<(typeof rows)[number]>[] = [
    { key: 'fact', header: '', label: t('connectPage.compare.fact'), cell: (row) => t(row.label) },
    ...props.cards.map((card, at) => ({
      key: card.id,
      header: card.name,
      label: card.name,
      clip: true,
      headerClass: `compare-${compareColour(at)}`,
      cellProps: (row: (typeof rows)[number]) => ({ 'data-best': row.cells[at]?.best }),
      cell: (row: (typeof rows)[number]) => row.cells[at]?.text,
    })),
  ];
  return (
    <section id="compare">
      <h3 className="panel-title">
        {t('connectPage.compare.heading', { count: props.cards.length })}
      </h3>
      {props.dropped.length ? (
        <p id="compare-note" role="status">
          {t('connectPage.compare.dropped', { names: props.dropped.join(', ') })}
        </p>
      ) : null}
      <div id="compare-table">
        <DataTable
          label={t('connectPage.compare.heading', { count: props.cards.length })}
          tableId="compare"
          labels={labels}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.label}
        />
      </div>
    </section>
  );
}

function DetailFacts({ card, detail }: { card: Card | undefined; detail: Detail | undefined }) {
  const { t } = useTranslation();
  const facts: [label: string, value: string | null][] =
    card && detail
      ? [
          [t('connectPage.facts.distance'), km(card.distance)],
          [t('connectPage.facts.movingTime'), clock(detail.movingTime)],
          [t('connectPage.facts.elapsedTime'), clock(detail.elapsedTime)],
          [t('connectPage.facts.averageSpeed'), kmh(detail.averageSpeed)],
          [t('connectPage.facts.topSpeed'), kmh(detail.maxSpeed)],
          [
            t('connectPage.facts.climbing'),
            card.elevationGain == null ? null : `${Math.round(card.elevationGain)} m`,
          ],
          [
            t('connectPage.facts.averageHr'),
            card.avgHr == null ? null : `${Math.round(card.avgHr)} bpm`,
          ],
          [
            t('connectPage.facts.averagePower'),
            card.avgPower == null ? null : `${Math.round(card.avgPower)} W`,
          ],
          [
            t('connectPage.facts.trainingLoad'),
            card.trainingLoad == null ? null : String(Math.round(card.trainingLoad)),
          ],
        ]
      : [];
  return (
    <dl id="detail">
      {facts
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <Fragment key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </Fragment>
        ))}
    </dl>
  );
}
