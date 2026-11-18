// The activities page: a summary strip, one filter bar, the table of every
// activity and a pane that previews the one pointed at, or compares the ones
// selected. The range, sports, sort, selection and comparison live in the hash.

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ParseKeys } from 'i18next';
import { useTranslation } from 'react-i18next';

import { Sparkline } from '../charts/Sparkline';
import { compareColour, compareRows, MAX_COMPARED } from '../compare';
import { clock, distanceUnit, km, kmh, metresOfDistance } from '../format';
import type { FeedFilter, SportFamily } from '../link';
import { sportMark, THUMB, trackShape } from '../preview';
import { go, queryValue, replaceRoute, type Route } from '../router';
import { registerShortcuts } from '../shortcuts';
import {
  useDetails,
  useFeed,
  type Card,
  type Detail,
  type Sparklines,
  type Summary,
} from '../feedReads';
import { ReadNotice } from '../shell/StatePanes';
import { useRead, type Read } from '../useRead';
import { SportGlyph } from '../SportGlyph';
import {
  COLUMNS,
  RANGES,
  RANGE_LABELS,
  columnsForWidth,
  feedQuery,
  rangeBounds,
  readFeedQuery,
  sortRows,
  type ColumnKey,
  type FeedQuery,
  type RangePreset,
  type Sort,
} from '../table';
import {
  Badge,
  Button,
  Chip,
  ChipGroup,
  DataTable,
  EmptyState,
  SegmentedControl,
  TextField,
  Skeleton,
  StatStrip,
  StatTile,
  type Column,
} from '../ui';
import { useTableLabels } from '../tableLabels';
import { filterCount } from '../ui/filterText';
import { useFilterDraft, useLastAnswered } from '../useFilterDraft';
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

/** How long the pointer rests on a row before the detail pane previews it. */
const PREVIEW_DELAY_MS = 300;

export function FeedPage({ route }: PageProps) {
  const [previewId, setPreviewId] = useState<string | null>(null);
  const feedState = readFeedQuery(route);
  const needle = feedState.search.trim();
  const familiesKey = feedState.families.join(',');
  const shownId = previewId ?? queryValue(route, 'id');
  const { minDistance, maxDistance, minMovingTime, maxMovingTime } = feedState;

  const filter = useMemo<FeedFilter>(() => {
    const { oldestTs, newestTs } = rangeBounds(feedState.range, new Date());
    const families = familiesKey ? (familiesKey.split(',') as SportFamily[]) : [];
    return {
      families,
      needle,
      oldestTs,
      newestTs,
      minDistance,
      maxDistance,
      minMovingTime,
      maxMovingTime,
    };
  }, [
    familiesKey,
    feedState.range,
    needle,
    minDistance,
    maxDistance,
    minMovingTime,
    maxMovingTime,
  ]);
  const feed = useFeed(filter);
  const details = useDetails([...(shownId ? [shownId] : []), ...feedState.ids]);

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
      matched={feed.matched}
      total={feed.total}
      sparklines={feed.sparklines.data ?? null}
      highlights={feed.highlights}
      previews={feed.previews}
      onMore={feed.loadMore}
      detail={shownId ? details[shownId] : undefined}
      shownId={shownId}
      route={route}
      query={feedState}
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
  matched: number | undefined;
  total: number | undefined;
  sparklines: Sparklines | null;
  highlights: Readonly<Record<string, string[]>>;
  previews: Readonly<Record<string, string>>;
  onMore: () => void;
  detail: Detail | undefined;
  shownId: string | null;
  route: Route;
  query: FeedQuery;
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
  // Until the first page answers, a count or chip would read as a zero the phone never gave.
  const answered = props.first.data !== undefined;
  // A new filter's rows are on their way: the table, and the field in its toolbar, stay mounted
  // with the rows already held, so typing is not interrupted.
  const held = useLastAnswered(answered ? props.cards : undefined);
  const matched = useLastAnswered(props.matched);
  const total = useLastAnswered(props.total);
  const rows = sortRows(held ?? [], props.query.sort);
  return (
    <section id="library">
      {props.summary.data ? (
        <SummaryStrip card={props.summary.data} lines={props.sparklines} />
      ) : props.summary.error && !props.first.error ? (
        <ReadNotice error={props.summary.error} onRetry={props.summary.retry} />
      ) : null}
      <FilterBar query={props.query} counts={answered ? props.familyCounts : null} />
      <div id="list-pane">
        {props.query.sort && props.more ? (
          <p id="sort-note" role="note">
            {t('connectPage.library.sortNote', { count: props.cards.length })}
          </p>
        ) : null}
        {held !== undefined ? (
          <>
            <FeedTable
              rows={rows}
              matched={matched}
              total={total}
              highlights={props.highlights}
              previews={props.previews}
              query={props.query}
              onPreview={props.onPreview}
              onDropped={setDropped}
            />
            {props.more ? <MoreButton onMore={props.onMore} /> : null}
          </>
        ) : props.first.error ? (
          <ReadNotice error={props.first.error} onRetry={props.first.retry} />
        ) : (
          <Skeleton lines={5} label={t('connectPage.read.loading')} />
        )}
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
    <StatStrip id="summary" label={t('connectPage.library.summary')}>
      {tiles.map((tile) => (
        <StatTile
          key={tile.key}
          label={tile.label}
          value={tile.value}
          note={tile.note}
          trend={
            tile.key === 'fitness' ? (
              <Sparkline
                className="summary-spark"
                range="fit"
                height={32}
                label={t('connectPage.library.fitnessTrend')}
                lines={[{ values: lines?.fitness ?? [] }]}
              />
            ) : undefined
          }
        />
      ))}
    </StatStrip>
  );
}

const SECONDS_PER_MINUTE = 60;

/** A bound as the text its field shows, in the field's unit to one decimal. */
function boundText(value: number | null, perUnit: number): string {
  return value === null ? '' : String(Math.round((value / perUnit) * 10) / 10);
}

/**
 * One min or max field. The typed text is written to the address once typing pauses; text that
 * is not a positive number clears the bound. `perUnit` is how many of the stored unit (metres or
 * seconds) the field's unit holds.
 */
function BoundField({
  label,
  placeholder,
  value,
  perUnit,
  onCommit,
}: {
  label: string;
  placeholder: string;
  value: number | null;
  perUnit: number;
  onCommit: (value: number | null) => void;
}) {
  const [draft, setDraft] = useFilterDraft(boundText(value, perUnit), (text) => {
    const typed = Number(text.trim().replace(',', '.'));
    onCommit(text.trim() !== '' && Number.isFinite(typed) && typed > 0 ? typed * perUnit : null);
  });
  return (
    <TextField
      label={label}
      hideLabel
      inputMode="decimal"
      placeholder={placeholder}
      value={draft}
      onChange={setDraft}
    />
  );
}

/** The library's extreme in the field's unit, as the placeholder of an empty field. */
function boundPlaceholder(value: number | null | undefined, perUnit: number): string {
  return value == null ? '' : String(Math.round((value / perUnit) * 10) / 10);
}

/**
 * The filter bar: the range, the distance and duration bounds and the sport families. The text
 * filter is in the table's toolbar.
 */
function FilterBar({
  query,
  counts,
}: {
  query: FeedQuery;
  /** Null until the phone has answered, so no chip reads as a zero it was never given. */
  counts: Readonly<Partial<Record<string, number>>> | null;
}) {
  const { t } = useTranslation();
  const everything = 'all';
  const bounds = useRead('feed.filterBounds', { unused: null }).data;
  const perDistanceUnit = metresOfDistance(1);
  const unit = distanceUnit();
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
      <fieldset className="bound-pair">
        <legend>{t('connectPage.library.distance', { unit })}</legend>
        <BoundField
          label={t('connectPage.library.distanceMin', { unit })}
          placeholder={boundPlaceholder(bounds?.minDistance, perDistanceUnit)}
          value={query.minDistance}
          perUnit={perDistanceUnit}
          onCommit={(minDistance) => goFeed({ ...query, minDistance })}
        />
        <BoundField
          label={t('connectPage.library.distanceMax', { unit })}
          placeholder={boundPlaceholder(bounds?.maxDistance, perDistanceUnit)}
          value={query.maxDistance}
          perUnit={perDistanceUnit}
          onCommit={(maxDistance) => goFeed({ ...query, maxDistance })}
        />
      </fieldset>
      <fieldset className="bound-pair">
        <legend>{t('connectPage.library.duration')}</legend>
        <BoundField
          label={t('connectPage.library.durationMin')}
          placeholder={boundPlaceholder(bounds?.minMovingTime, SECONDS_PER_MINUTE)}
          value={query.minMovingTime}
          perUnit={SECONDS_PER_MINUTE}
          onCommit={(minMovingTime) => goFeed({ ...query, minMovingTime })}
        />
        <BoundField
          label={t('connectPage.library.durationMax')}
          placeholder={boundPlaceholder(bounds?.maxMovingTime, SECONDS_PER_MINUTE)}
          value={query.maxMovingTime}
          perUnit={SECONDS_PER_MINUTE}
          onCommit={(maxMovingTime) => goFeed({ ...query, maxMovingTime })}
        />
      </fieldset>
      {counts ? (
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
      ) : null}
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
  matched,
  total,
  highlights,
  previews,
  query,
  onPreview,
  onDropped,
}: {
  rows: Card[];
  matched: number | undefined;
  total: number | undefined;
  highlights: Readonly<Record<string, string[]>>;
  previews: Readonly<Record<string, string>>;
  query: FeedQuery;
  onPreview: (id: string | null) => void;
  onDropped: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const labels = useTableLabels();
  const [draft, setDraft] = useFilterDraft(query.search, (search) =>
    replaceRoute({ screen: 'activities', id: null, query: feedQuery({ ...query, search }) })
  );
  const hover = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(hover.current);
      onPreview(null);
    },
    [onPreview]
  );
  const shown = columnsForWidth(useWindowWidth());
  const columns: Column<Card>[] = COLUMNS.filter((column) => shown.includes(column.key)).map(
    (column) => ({
      key: column.key,
      header: t(column.label),
      numeric: column.numeric,
      sortable: true,
      clip: column.key === 'name',
      primary: column.key === 'name',
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
    })
  );
  return (
    <div id="feed-scroll" className="feed-table">
      <DataTable
        label={t('connectPage.library.activities')}
        tableId="feed"
        labels={labels}
        filter={{
          id: 'search',
          label: t('connectPage.filter.activities'),
          clearLabel: t('connectPage.filter.clear'),
          value: draft,
          onChange: setDraft,
          count: matched === undefined || total === undefined ? null : filterCount(matched, total),
          countText: (count) => t('connectPage.filter.count', count),
        }}
        rowAction="open"
        selectable
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
        selectedKey={query.id ?? null}
        {...(query.ids.length >= 2 ? { selectedKeys: query.ids } : {})}
        onActiveChange={(card) =>
          replaceRoute({
            screen: 'activities',
            id: null,
            query: feedQuery({ ...query, id: card.id, ids: [] }),
          })
        }
        onSelectionChange={(chosen) => {
          const ids = chosen.map((card) => card.id);
          onDropped(ids.slice(MAX_COMPARED));
          const held = ids.slice(0, MAX_COMPARED);
          goFeed(
            held.length >= 2
              ? { ...query, ids: held, id: query.id ?? held[0] ?? null }
              : { ...query, ids: [], id: query.id }
          );
        }}
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
