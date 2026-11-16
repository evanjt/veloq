// The strength page: the period's volume on a body, the balance of opposing muscles, each
// muscle's progression over the trailing weeks, and the muscles, weeks and exercises as tables. A
// muscle chosen on the body or in its table narrows the exercise table to it. The volumes,
// verdicts and trends are the engine's; the page arranges them.

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { balancePairName, muscleName } from '../../../src/features/strength/lib/muscleNames';
import { BodyFigure } from '../BodyFigure';
import { settledNow, wallSeconds } from '../fitness';
import { strengthPeriodDays } from '../link';
import { go, queryValue, withQuery, write, type Route } from '../router';
import type { Methods } from '../schema';
import { Reading } from '../shell/StatePanes';
import { useTableLabels } from '../tableLabels';
import { nextOrder, orderRows, readTableOrder, sortProp, writeTableOrder } from '../tableOrder';
import {
  chosenMuscle,
  exerciseRows,
  intensities,
  muscleSplit,
  pairShares,
  type ExerciseRow,
} from '../strengthView';
import { Button, Card, CardHeader, DataTable, SegmentedControl, type Column } from '../ui';
import { useRead } from '../useRead';
import type { PageProps } from './types';

type Screen = Methods['strength.screen']['result'];
type Volume = Screen['summary']['muscleVolumes'][number];
type Week = Screen['weekly'][number];
type Progression = Screen['progressions'][number];

/** A week or session start, read as the local date the engine stamped it with. */
export const dayOf = (wallSecondsValue: number) =>
  new Date(wallSecondsValue * 1000).toISOString().slice(0, 10);

/** Sets, which may be a half where a secondary muscle counts half. */
export const setCount = (sets: number) => String(Math.round(sets * 10) / 10);

const STRENGTH_PERIODS = [
  ['7d', 'connectPage.strength.period7d'],
  ['1m', 'connectPage.strength.period1m'],
  ['3m', 'connectPage.strength.period3m'],
  ['6m', 'connectPage.strength.period6m'],
  ['1y', 'connectPage.strength.period1y'],
] as const;

/** The strength page's own address, keeping the period and the muscle but not the phone's old `type`. */
const pageRoute = (route: Route): Route => ({
  screen: 'strength',
  id: null,
  query: route.query.filter(([key]) => key !== 'type'),
});

type MuscleColumn = 'muscle' | 'sets' | 'reps' | 'volume';
type WeekColumn = 'week' | 'sessions' | 'sets' | 'most';
type ExerciseColumn = 'name' | 'muscles' | 'sets' | 'reps' | 'volume';

const MUSCLE_ORDER = { column: 'sets', descending: true } as const;
const WEEK_ORDER = { column: 'week', descending: true } as const;
const EXERCISE_ORDER = { column: 'volume', descending: true } as const;

/** One muscle's weekly weighted sets as a line, the peak week at the top of the box. */
function Sparkline({ values }: { values: number[] }) {
  const peak = Math.max(1, ...values);
  const step = values.length > 1 ? 100 / (values.length - 1) : 0;
  const points = values
    .map((value, at) => `${(at * step).toFixed(1)},${(22 - (value / peak) * 20).toFixed(1)}`)
    .join(' ');
  return (
    <svg className="progression-line" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden>
      <polyline points={points} />
    </svg>
  );
}

function ProgressionCard({ progression, name }: { progression: Progression; name: string }) {
  const { t } = useTranslation();
  const change = progression.changePct;
  return (
    <li className="progression" data-trend={progression.trend} data-muscle={progression.muscleSlug}>
      <div className="progression-head">
        <strong>{name}</strong>
        {change === null ? null : (
          <span className="progression-change">
            {change > 0 ? '+' : ''}
            {Math.round(change)}%
          </span>
        )}
      </div>
      <Sparkline values={progression.weeklyWeightedSets} />
      <dl className="progression-facts">
        <dt>{t('strength.recentAvg')}</dt>
        <dd>{setCount(progression.recentAverage)}</dd>
        <dt>{t('strength.earlierAvg')}</dt>
        <dd>{setCount(progression.baselineAverage)}</dd>
        <dt>{t('strength.peakWeek')}</dt>
        <dd>{setCount(progression.peakWeightedSets)}</dd>
      </dl>
    </li>
  );
}

/** One opposing pair as a bar split between its two sides, wider for the side that carries more. */
function BalanceRow({
  pair,
  names,
}: {
  pair: Screen['summary']['balance'][number];
  names: (slug: string) => string;
}) {
  const { t } = useTranslation();
  const shares = pairShares(pair);
  return (
    <li className="balance-pair" data-status={pair.status} data-pair={pair.id}>
      <div className="balance-title">
        <strong>{balancePairName(pair.id, t)}</strong>
        <span className="balance-ratio">
          {pair.ratio === null ? pair.status : `${(Math.round(pair.ratio * 10) / 10).toFixed(1)}×`}
        </span>
      </div>
      <div className="balance-bar" role="img" aria-label={`${names(pair.leftSlug)} ${setCount(pair.leftWeightedSets)}, ${names(pair.rightSlug)} ${setCount(pair.rightWeightedSets)}`}>
        <span className="balance-left" style={{ flexGrow: shares.left }} />
        <span className="balance-right" style={{ flexGrow: shares.right }} />
      </div>
      <div className="balance-sides">
        <span>
          {names(pair.leftSlug)} · {setCount(pair.leftWeightedSets)}
        </span>
        <span>
          {setCount(pair.rightWeightedSets)} · {names(pair.rightSlug)}
        </span>
      </div>
    </li>
  );
}

/** The strength page with the engine's screen, or without it while it is read. */
function StrengthPane({ route, screen }: { route: Route; screen: Screen | undefined }) {
  const { t } = useTranslation();
  const labels = useTableLabels();
  const base = pageRoute(route);
  const days = strengthPeriodDays(queryValue(route, 'period'));
  const period =
    STRENGTH_PERIODS.find(([key]) => strengthPeriodDays(key) === days)?.[0] ?? STRENGTH_PERIODS[0][0];
  const names = (slug: string) => muscleName(slug, t);
  const volumes = screen?.summary.muscleVolumes ?? [];
  const muscle = chosenMuscle(queryValue(route, 'muscle'), volumes);
  const choose = (slug: string) =>
    go(withQuery(base, { muscle: slug === muscle ? null : slug }));
  const split = muscleSplit(screen?.exercises ?? [], muscle);
  const owed = screen?.owedCount ?? 0;

  const muscleOrder = readTableOrder<MuscleColumn>(
    route,
    'strength-muscles',
    ['muscle', 'sets', 'reps', 'volume'],
    MUSCLE_ORDER
  );
  const weekOrder = readTableOrder<WeekColumn>(
    route,
    'strength-weeks',
    ['week', 'sessions', 'sets', 'most'],
    WEEK_ORDER
  );
  const exerciseOrder = readTableOrder<ExerciseColumn>(
    route,
    'strength-exercises',
    ['name', 'muscles', 'sets', 'reps', 'volume'],
    EXERCISE_ORDER
  );

  const muscleRows = orderRows(volumes, muscleOrder, (row, column) =>
    column === 'muscle'
      ? names(row.slug)
      : column === 'sets'
        ? row.weightedSets
        : column === 'reps'
          ? row.totalReps
          : row.volumeKg
  );
  const weekRows = orderRows(screen?.weekly ?? [], weekOrder, (row, column) =>
    column === 'week'
      ? row.startTs
      : column === 'sessions'
        ? row.activityCount
        : column === 'sets'
          ? row.totalSets
          : row.maxWeightedSets
  );
  const exercises = exerciseRows(screen?.exercises ?? [], muscle);
  const exerciseSorted = orderRows(exercises, exerciseOrder, (row, column) =>
    column === 'name'
      ? row.name
      : column === 'muscles'
        ? row.muscles.length
        : column === 'sets'
          ? row.sets
          : column === 'reps'
            ? row.reps
            : row.volumeKg
  );

  const muscleColumns: Column<Volume>[] = [
    {
      key: 'muscle',
      header: t('connectPage.strength.colMuscle'),
      sortable: true,
      clip: true,
      cell: (row) => names(row.slug),
    },
    {
      key: 'sets',
      header: t('connectPage.strength.colWeightedSets'),
      numeric: true,
      sortable: true,
      cell: (row) => setCount(row.weightedSets),
    },
    {
      key: 'reps',
      header: t('connectPage.strength.colReps'),
      numeric: true,
      sortable: true,
      cell: (row) => String(row.totalReps),
    },
    {
      key: 'volume',
      header: t('connectPage.strength.colVolume'),
      numeric: true,
      sortable: true,
      cell: (row) => String(Math.round(row.volumeKg)),
    },
  ];
  const weekColumns: Column<Week>[] = [
    {
      key: 'week',
      header: t('connectPage.strength.colWeekOf'),
      sortable: true,
      cell: (row) => dayOf(row.startTs),
    },
    {
      key: 'sessions',
      header: t('connectPage.strength.colSessions'),
      numeric: true,
      sortable: true,
      cell: (row) => String(row.activityCount),
    },
    {
      key: 'sets',
      header: t('connectPage.strength.colSets'),
      numeric: true,
      sortable: true,
      cell: (row) => String(row.totalSets),
    },
    {
      key: 'most',
      header: t('connectPage.strength.colMostWorked'),
      numeric: true,
      sortable: true,
      cell: (row) => setCount(row.maxWeightedSets),
    },
  ];
  const exerciseColumns: Column<ExerciseRow>[] = [
    {
      key: 'name',
      header: t('connectPage.strength.exercise'),
      sortable: true,
      clip: true,
      cell: (row) => row.name,
    },
    {
      key: 'muscles',
      header: t('connectPage.strength.muscles'),
      sortable: true,
      cell: (row) => row.muscles.map(names).join(', '),
    },
    {
      key: 'sets',
      header: t('connectPage.strength.colSets'),
      numeric: true,
      sortable: true,
      cell: (row) => String(row.sets),
    },
    {
      key: 'reps',
      header: t('connectPage.strength.colReps'),
      numeric: true,
      sortable: true,
      cell: (row) => String(row.reps),
    },
    {
      key: 'volume',
      header: t('connectPage.strength.colVolume'),
      numeric: true,
      sortable: true,
      cell: (row) => String(Math.round(row.volumeKg)),
    },
  ];

  const sorted = <C extends string>(
    table: string,
    order: { column: C; descending: boolean },
    fallback: { column: C; descending: boolean },
    numeric: readonly C[]
  ) => ({
    sort: sortProp(order),
    onSort: (key: string) =>
      go(
        writeTableOrder(
          route,
          table,
          nextOrder(order, key as C, numeric.includes(key as C)),
          fallback
        )
      ),
  });

  return (
    <section id="strength">
      <div className="strength-toolbar">
        <SegmentedControl
          id="strength-periods"
          label={t('connectPage.strength.period')}
          value={period}
          options={STRENGTH_PERIODS.map(([key, label]) => ({ value: key, label: t(label) }))}
          onChange={(next) => go(withQuery(base, { period: next }))}
        />
        <div className="strength-actions">
          <a id="strength-workouts" href={write({ screen: 'workouts', id: null, query: [] })}>
            {t('connectPage.workouts.open')}
          </a>
          <a id="strength-live" href="#/live">
            {t('connectPage.live.open')}
          </a>
        </div>
      </div>
      {owed > 0 ? (
        <p id="strength-owed" className="notice" role="status">
          {t('connectPage.strength.owed', { count: owed })}
        </p>
      ) : null}

      <div className="strength-overview">
        <Card label={t('strength.muscleGroupVolume')}>
          <CardHeader
            title={t('strength.muscleGroupVolume')}
            actions={
              muscle === null ? null : (
                <Button size="sm" variant="ghost" onClick={() => choose(muscle)}>
                  {t('strength.clearMuscle', { muscle: names(muscle) })}
                </Button>
              )
            }
          />
          <BodyFigure
            intensity={intensities(volumes)}
            names={names}
            chosen={muscle}
            onChoose={choose}
          />
          <p className="meta">{t('strength.relativeWeightedSets')}</p>
        </Card>
        <Card label={t('connectPage.strength.balance')}>
          <CardHeader title={t('connectPage.strength.balance')} />
          <ul id="strength-balance" className="balance-list">
            {(screen?.summary.balance ?? []).map((pair) => (
              <BalanceRow key={pair.id} pair={pair} names={names} />
            ))}
          </ul>
          <p className="meta">{t('strength.balanceFootnote')}</p>
        </Card>
        <Card label={t('connectPage.strength.progressions')}>
          <CardHeader title={t('connectPage.strength.progressions')} />
          <ul id="strength-progressions" className="progression-list">
            {(screen?.progressions ?? []).map((progression) => (
              <ProgressionCard
                key={progression.muscleSlug}
                progression={progression}
                name={names(progression.muscleSlug)}
              />
            ))}
          </ul>
        </Card>
      </div>

      <div className="strength-tables">
        <div className="strength-table">
          <CardHeader
            title={
              muscle === null
                ? t('connectPage.strength.exercises')
                : t('strength.exercisesTargeting', { muscle: names(muscle) })
            }
          />
          {split === null ? null : (
            <p
              id="strength-muscle-split"
              className="meta"
              data-primary={split.primary}
              data-secondary={split.secondary}
            >
              {t('connectPage.strength.muscleSplit', {
                primary: split.primary,
                secondary: split.secondary,
              })}
            </p>
          )}
          <DataTable
            label={t('connectPage.strength.exercises')}
            tableId="strength-exercises"
            labels={labels}
            columns={exerciseColumns}
            rows={exerciseSorted}
            rowKey={(row) => String(row.category)}
            href={(row) => write({ screen: 'exercise', id: String(row.category), query: [] })}
            {...sorted('strength-exercises', exerciseOrder, EXERCISE_ORDER, [
              'sets',
              'reps',
              'volume',
            ])}
          />
        </div>
        <div className="strength-table">
          <CardHeader title={t('connectPage.strength.muscles')} />
          <DataTable
            label={t('connectPage.strength.muscles')}
            tableId="strength-muscles"
            labels={labels}
            columns={muscleColumns}
            rows={muscleRows}
            rowKey={(row) => row.slug}
            selectedKey={muscle}
            onRowClick={(row) => choose(row.slug)}
            {...sorted('strength-muscles', muscleOrder, MUSCLE_ORDER, ['sets', 'reps', 'volume'])}
          />
          <CardHeader title={t('connectPage.strength.weeks')} />
          <DataTable
            label={t('connectPage.strength.weeks')}
            tableId="strength-weeks"
            labels={labels}
            columns={weekColumns}
            rows={weekRows}
            rowKey={(row) => String(row.startTs)}
            {...sorted('strength-weeks', weekOrder, WEEK_ORDER, [
              'week',
              'sessions',
              'sets',
              'most',
            ])}
          />
        </div>
      </div>
    </section>
  );
}

export function StrengthPage({ route }: PageProps) {
  const days = strengthPeriodDays(queryValue(route, 'period'));
  const nowWallSeconds = useMemo(() => wallSeconds(settledNow()), []);
  const read = useRead('strength.screen', { nowWallSeconds, periodDays: days });
  return (
    <>
      {read.data === undefined ? <StrengthPane route={route} screen={undefined} /> : null}
      <Reading read={read}>{(screen) => <StrengthPane route={route} screen={screen} />}</Reading>
    </>
  );
}
