// A route's detail on the desktop page: the name in place, the facts, three views of the
// attempts (over time, spread, ahead or behind) and the attempts table. A dot on a chart, a row of
// the table and the line on the map are one selection, held by the page. The engine computes every
// figure; this places and orders what it answered.

import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Chart } from '../charts/Chart';
import type { Compared } from '../compare';
import { clock as clockOf, km, kmh } from '../format';
import {
  ATTEMPT_COLUMNS,
  RANGE_DAYS,
  attemptsAsk,
  attemptsOf,
  deltaSeriesOf,
  performanceAsk,
  pressedAttempts,
  rankedAttempts,
  recordSteps,
  referenceTimeOf,
  sideOf,
  spreadBins,
  trendBandOf,
  type Attempt,
  type AttemptColumn,
  type Performance,
  type RankedAttempt,
  type RouteAttempts,
  type Side,
} from '../routesDetail';
import { parseOrder, type Ordering } from '../router';
import { callOf } from '../routesEdits';
import type { Write } from '../useBatch';
import type { Methods } from '../schema';
import { usePageName } from '../shell/pageName';
import { useTableLabels } from '../tableLabels';
import { Button, ContextMenu, EmptyState, Skeleton, Tabs, DataTable, type Column } from '../ui';
import { UNLESS_STORED } from '../query';
import { useEdit } from '../useEdit';
import { useBatch } from '../useBatch';
import { useQueries } from '../useRead';
import type { Editor } from '../useEdit';
import { Facts, Refused, RenameField, useRouteRead } from './routePanes';

type RouteDetailResult = Methods['route.detail']['result'];

const DEFAULT_ORDER = { column: 'date', descending: true } as const;

/** The three reads a route's detail is drawn from, asked once for the page and the pane alike. */
export function useRouteModel(id: string | null) {
  return {
    detail: useRouteRead<RouteDetailResult>('route.detail', id ? { id } : null),
    performance: useRouteRead<Performance>(
      'route.performance',
      id ? performanceAsk(id, RANGE_DAYS) : null
    ),
    attempts: useRouteRead<RouteAttempts>('route.attempts', id ? attemptsAsk(id) : null),
  };
}
export type RouteModel = ReturnType<typeof useRouteModel>;

/** The attempts as the table and the map's colouring use them, the engine's best marked. */
export function attemptsOfModel(model: RouteModel): Attempt[] {
  const best = model.attempts.value?.best?.activityId;
  return (model.attempts.value?.performances ?? []).map((p) => ({
    activityId: p.activityId,
    name: p.name,
    date: p.date,
    speed: p.speed,
    movingTime: p.movingTime,
    isBest: p.activityId === best,
  }));
}

/** The activity the engine measures attempts against, when it has named one. */
export function referenceOf(model: RouteModel): { id: string; source: string } | null {
  const forward = model.performance.value?.curves?.forward;
  return forward ? { id: forward.referenceActivityId, source: forward.referenceSource } : null;
}

/**
 * Which side of the reference the picked attempt finished, for the map's colouring. Null with no
 * attempt picked or no attempts.
 */
export function pickedSide(model: RouteModel, picked: string | null): Side | null {
  const rows = attemptsOfModel(model);
  const row = rows.find((candidate) => candidate.activityId === picked);
  const reference = referenceTimeOf(rows, referenceOf(model)?.id ?? null);
  return row && reference !== null ? sideOf(row.movingTime, reference) : null;
}

/** A duration as the table writes it; empty for none. */
const clock = (seconds: number) => clockOf(seconds) ?? '';

const dateOf = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

type View = 'time' | 'spread' | 'delta';
const VIEWS: readonly View[] = ['time', 'spread', 'delta'];

/** The views over the attempts: each reads what the engine answered and none computes a figure. */
function Views({
  model,
  id,
  selected,
  picked,
  editor,
  onPick,
}: {
  model: RouteModel;
  id: string;
  selected: readonly string[];
  picked: string | null;
  editor: Editor;
  onPick: (activityId: string) => void;
}) {
  const { t } = useTranslation();
  const [view, setView] = useState<View>('time');
  const performance = model.performance.value;
  const names: Record<View, string> = {
    time: t('connectPage.routes.viewTime'),
    spread: t('connectPage.routes.viewSpread'),
    delta: t('connectPage.routes.viewDelta'),
  };
  if (model.performance.failed && model.performance.error) {
    return (
      <Refused
        error={model.performance.error}
        title={t('connectPage.routes.performanceFailed')}
        plain
      />
    );
  }
  if (!performance) return <Skeleton label={t('connectPage.routes.reading')} />;
  const points = [...performance.chartData.points].sort((a, b) => a.activityDate - b.activityDate);
  const pickedAt = points.findIndex((point) => point.activityId === picked);
  const panels: Record<View, React.ReactNode> = {
    time: (
      <Chart
        kind="scatter"
        label={t('connectPage.routes.performanceChart')}
        empty={t('connectPage.routes.noAttempts')}
        none={t('connectPage.routes.none')}
        categories={points.map((point) => `${dateOf(point.activityDate)} ${point.activityName}`)}
        series={[
          {
            name: t('connectPage.routes.time'),
            colour: 'var(--colour-chart-series)',
            values: points.map((point) => point.sectionTime),
          },
        ]}
        x={{ values: points.map((point) => point.activityDate * 1000), kind: 'time' }}
        format={clock}
        xTitle={t('connectPage.routes.axisDate')}
        yTitle={t('connectPage.routes.axisTime')}
        curveBand={{ points: trendBandOf(performance.trendCurves.forwardTime) }}
        steps={{
          name: t('connectPage.routes.records'),
          colour: 'var(--colour-data-div-warm-2)',
          points: recordSteps(performance.recordProgression.forward).map(
            ([date, seconds]) => [date * 1000, seconds] as const
          ),
        }}
        picked={pickedAt >= 0 ? pickedAt : null}
        onPick={(at) => {
          const point = points[at];
          if (point) onPick(point.activityId);
        }}
        height={240}
      />
    ),
    spread: (() => {
      const bins = spreadBins(performance.histograms.forward);
      return (
        <Chart
          kind="bar"
          label={t('connectPage.routes.spreadChart')}
          empty={t('connectPage.routes.spreadEmpty')}
          none={t('connectPage.routes.none')}
          categories={bins.map((bin) => clock(bin.low))}
          series={[
            {
              name: t('connectPage.routes.attempts'),
              colour: 'var(--colour-chart-series)',
              values: bins.map((bin) => bin.count),
            },
          ]}
          format={String}
          xTitle={t('connectPage.routes.axisBin')}
          yTitle={t('connectPage.routes.attempts')}
          height={240}
        />
      );
    })(),
    delta: <DeltaView model={model} id={id} selected={selected} picked={picked} editor={editor} />,
  };
  return (
    <Tabs
      label={t('connectPage.routes.views')}
      value={view}
      onChange={(next) => setView(next as View)}
      items={VIEWS.map((key) => ({ id: key, label: names[key], panel: panels[key] }))}
    />
  );
}

/** The selected attempt's time ahead of or behind the reference along the route, and the typical attempt's. */
function DeltaView({
  model,
  id,
  selected,
  picked,
  editor,
}: {
  model: RouteModel;
  id: string;
  selected: readonly string[];
  picked: string | null;
  editor: Editor;
}) {
  const { t } = useTranslation();
  const performance = model.performance.value;
  const curves = performance?.curves;
  const direction = curves?.forward ?? null;
  const reference = referenceOf(model);
  const attempts = attemptsOfModel(model);
  const referenceRow = attempts.find((row) => row.activityId === reference?.id);
  const series = deltaSeriesOf(direction, picked, curves?.gridStepM ?? 0);
  const setTo = selected.length === 1 ? (selected[0] ?? null) : null;
  const reset = direction?.referenceSource === 'athleteSet';
  return (
    <>
      <p className="reference">
        {referenceRow
          ? t('connectPage.routes.referenceIs', {
              date: dateOf(referenceRow.date),
              time: clock(referenceRow.movingTime),
            })
          : t('connectPage.routes.referenceNone')}
        <Button
          size="sm"
          disabled={setTo === null || setTo === reference?.id}
          onClick={() => {
            if (setTo) void editor.run({ kind: 'setReference', id, activityId: setTo });
          }}
        >
          {t('connectPage.routes.setReference')}
        </Button>
        {reset ? (
          <Button size="sm" onClick={() => void editor.run({ kind: 'resetReference', id })}>
            {t('connectPage.routes.resetReference')}
          </Button>
        ) : null}
      </p>
      {series.metres.length === 0 ? (
        <p className="meta">
          {performance?.curvesPending
            ? t('connectPage.routes.deltaPending')
            : t('connectPage.routes.deltaEmpty')}
          {performance?.curvesPending ? (
            <Button size="sm" onClick={model.performance.retry}>
              {t('connectPage.routes.retry')}
            </Button>
          ) : null}
        </p>
      ) : (
        <Chart
          kind="line"
          label={t('connectPage.routes.deltaChart')}
          empty={t('connectPage.routes.deltaEmpty')}
          none={t('connectPage.routes.none')}
          categories={series.metres.map((metres) => km(metres) ?? '')}
          series={[
            ...(series.selected
              ? [
                  {
                    name: t('connectPage.routes.selectedAttempt'),
                    colour: 'var(--colour-data-div-cool-2)',
                    values: series.selected,
                  },
                ]
              : []),
            ...(series.typical
              ? [
                  {
                    name: t('connectPage.routes.typicalAttempt'),
                    colour: 'var(--colour-chart-reference)',
                    values: series.typical,
                  },
                ]
              : []),
          ]}
          x={{ values: series.metres, kind: 'number', format: (metres) => km(metres) ?? '' }}
          format={(secs) => `${secs > 0 ? '+' : ''}${Math.round(secs)} s`}
          xTitle={t('connectPage.routes.axisDistance')}
          yTitle={t('connectPage.routes.axisDelta')}
          height={240}
        />
      )}
      {picked === null ? <p className="meta">{t('connectPage.routes.deltaPick')}</p> : null}
    </>
  );
}

type Row = RankedAttempt;

/**
 * The attempts table: sortable, multi-select, with the exclude and include bulk actions and a
 * context menu that makes the attempt under the pointer the route's reference.
 */
function AttemptsTable({
  id,
  editor,
  rows,
  selected,
  set,
  order: orderText,
  onOrder,
  onSelect,
  onHover,
  onExclude,
}: {
  rows: Attempt[];
  selected: readonly string[];
  /** The attempts drawn together on the map's overlay, each with its colour. */
  set: readonly Compared[];
  order: string | null;
  onOrder: (order: Ordering<string>) => void;
  onSelect: (ids: string[]) => void;
  onHover: (id: string | null) => void;
  onExclude: (ids: string[]) => void;
  id: string;
  editor: Editor;
}) {
  const { t } = useTranslation();
  const labels = useTableLabels();
  // The row a right click landed on, which the menu's items act on.
  const [menuRow, setMenuRow] = useState<string | null>(null);
  const order = parseOrder<AttemptColumn>(orderText, ATTEMPT_COLUMNS, DEFAULT_ORDER);
  const ranked = rankedAttempts(rows);
  const ordered = attemptsOf(ranked, order) as Row[];
  const headers: Record<AttemptColumn, string> = {
    date: t('connectPage.strength.colDate'),
    time: t('connectPage.facts.time'),
    gap: t('connectPage.routes.gap'),
    rank: t('connectPage.routes.rank'),
    speed: t('connectPage.routes.speed'),
  };
  const cells: Record<AttemptColumn, Column<Row>['cell']> = {
    date: (row) => dateOf(row.date),
    time: (row) => clock(row.movingTime),
    gap: (row) => (row.gap === 0 ? '–' : `+${clock(row.gap)}`),
    rank: (row) => String(row.rank),
    speed: (row) => kmh(row.speed),
  };
  const columns: Column<Row>[] = ATTEMPT_COLUMNS.map((column) => ({
    key: column,
    header: headers[column],
    sortable: true,
    numeric: column !== 'date',
    defaultHidden: column === 'speed',
    cell: cells[column],
  }));
  const menu = [
    {
      id: 'setReference',
      label: t('connectPage.routes.setReference'),
      disabled: menuRow === null,
      onSelect: () => {
        if (menuRow) void editor.run({ kind: 'setReference', id, activityId: menuRow });
      },
    },
    {
      id: 'resetReference',
      label: t('connectPage.routes.resetReference'),
      onSelect: () => void editor.run({ kind: 'resetReference', id }),
    },
  ];
  return (
    <div
      onContextMenuCapture={(event) =>
        setMenuRow(
          (event.target as HTMLElement).closest?.('[data-row]')?.getAttribute('data-row') ?? null
        )
      }
    >
      <ContextMenu label={t('connectPage.routes.attemptsMenu')} items={menu}>
        <DataTable
          label={t('connectPage.routes.attemptsTable')}
          tableId="route-attempts"
          labels={labels}
          columns={columns}
          rows={ordered}
          rowKey={(row) => row.activityId}
          marker={{
            header: null,
            cell: (row) => {
              const colour = set.find((entry) => entry.id === row.activityId)?.colour;
              return colour ? <span className={`swatch ${colour}`} /> : null;
            },
          }}
          rowProps={(row) => ({ 'data-pr': row.isBest })}
          href={(row) => `#/activity/${encodeURIComponent(row.activityId)}`}
          sort={{ key: order.column, direction: order.descending ? 'desc' : 'asc' }}
          onSort={(key) => onOrder(pressedAttempts(order, key as AttemptColumn))}
          selectable
          selectedKeys={selected}
          onSelectionChange={(chosen) => onSelect(chosen.map((row) => row.activityId))}
          onRowHover={(row) => onHover(row?.activityId ?? null)}
          bulkActions={[
            {
              key: 'exclude',
              label: t('connectPage.routes.excludeSelected'),
              run: (chosen) => onExclude(chosen.map((row) => row.activityId)),
            },
          ]}
        />
      </ContextMenu>
    </div>
  );
}

type Excluded = { id: string };

/** The attempts left out of the route's figures, each to bring back. */
function ExcludedTable({
  ids,
  onInclude,
}: {
  ids: readonly string[];
  onInclude: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const labels = useTableLabels();
  return (
    <details className="excluded" open>
      <summary>{t('connectPage.routes.excludedHeading', { n: ids.length })}</summary>
      <DataTable
        label={t('connectPage.routes.excludedTable')}
        labels={labels}
        columns={[
          {
            key: 'id',
            header: t('connectPage.routes.activity'),
            clip: true,
            cell: (row: Excluded) => row.id,
          },
        ]}
        rows={ids.map((id) => ({ id }))}
        rowKey={(row) => row.id}
        selectable
        bulkActions={[
          {
            key: 'include',
            label: t('connectPage.routes.includeSelected'),
            run: (chosen) => onInclude(chosen.map((row) => row.id)),
          },
        ]}
      />
    </details>
  );
}

export function RoutePane({
  id,
  model,
  selected,
  set,
  picked,
  order,
  onOrder,
  onSelect,
  onHover,
}: {
  id: string;
  model: RouteModel;
  selected: readonly string[];
  set: readonly Compared[];
  picked: string | null;
  order: string | null;
  onOrder: (order: Ordering<string>) => void;
  onSelect: (ids: string[]) => void;
  onHover: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const naming = useEdit();
  const editing = useEdit();
  const queries = useQueries();
  const batch = useBatch(queries, t('connectPage.routes.editFailed'));
  const detail = model.detail.value;
  usePageName(detail?.group?.customName);
  if (model.detail.failed && model.detail.error) {
    return <Refused error={model.detail.error} title={t('connectPage.routes.routeFailed')} />;
  }
  if (!detail) return <Skeleton label={t('connectPage.routes.reading')} />;

  /** Send each id's edit as one batch, whose one toast undoes them all. */
  const change = async (ids: string[], excluded: boolean) => {
    const writes = (to: boolean) =>
      ids.map((activityId) =>
        callOf({ kind: 'routePass', id, activityId, excluded: to })
      ) as Write[];
    const taken = await batch.run(
      writes(excluded),
      t(excluded ? 'connectPage.routes.attemptsExcluded' : 'connectPage.routes.attemptsIncluded', {
        count: ids.length,
      }),
      writes(!excluded),
      t('connectPage.routes.undo')
    );
    // The batch's last write names no reads, so the route's are asked again here, once.
    if (taken) queries.invalidate(UNLESS_STORED);
    if (taken && excluded) onSelect(selected.filter((chosen) => !ids.includes(chosen)));
  };

  return (
    <>
      <RenameField
        key={detail.group?.customName ?? ''}
        value={detail.group?.customName ?? ''}
        label={t('connectPage.routes.name')}
        editor={naming}
        edit={(name) => ({ kind: 'renameRoute', id, name, was: detail.group?.customName ?? '' })}
      />
      <Facts
        facts={[
          [t('connectPage.routes.sortActivities'), String(detail.activityCount)],
          [t('connectPage.facts.distance'), km(detail.distanceMeters)],
          [t('connectPage.facts.climbing'), `${Math.round(detail.elevationGainMeters)} m`],
        ]}
      />
      <Views
        model={model}
        id={id}
        selected={selected}
        picked={picked}
        editor={editing}
        onPick={(activityId) => onSelect([activityId])}
      />
      {model.attempts.failed && model.attempts.error ? (
        <Refused
          error={model.attempts.error}
          title={t('connectPage.routes.performanceFailed')}
          plain
        />
      ) : model.attempts.value ? (
        attemptsOfModel(model).length === 0 ? (
          <EmptyState title={t('connectPage.routes.noAttempts')} />
        ) : (
          <AttemptsTable
            id={id}
            editor={editing}
            rows={attemptsOfModel(model)}
            selected={selected}
            set={set}
            order={order}
            onOrder={onOrder}
            onSelect={onSelect}
            onHover={onHover}
            onExclude={(ids) => void change(ids, true)}
          />
        )
      ) : (
        <Skeleton label={t('connectPage.routes.reading')} />
      )}
      {detail.excludedActivityIds.length > 0 ? (
        <ExcludedTable
          ids={detail.excludedActivityIds}
          onInclude={(ids) => void change(ids, false)}
        />
      ) : null}
      {(batch.refusal ?? editing.refusal) ? (
        <p className="notice" role="alert">
          {batch.refusal ?? editing.refusal}
        </p>
      ) : null}
    </>
  );
}
