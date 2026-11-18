// One strength exercise: its best set in each session as a chart, and the sessions as a table.

import { useTranslation } from 'react-i18next';

import { Chart } from '../charts/Chart';
import type { Methods } from '../schema';
import { write } from '../router';
import { Reading } from '../shell/StatePanes';
import { usePageName } from '../shell/pageName';
import { useTableLabels } from '../tableLabels';
import { DataTable, EmptyState, type Column } from '../ui';
import { useRead } from '../useRead';
import { dayOf } from './Strength';
import type { PageProps } from './types';

type Session = Methods['strength.exercise']['result']['sessions'][number];

/** The exercise category a route names, or null when it is not one. */
export function exerciseOf(id: string | null): number | null {
  const category = Number(id);
  return id !== null && Number.isInteger(category) && category >= 0 && category <= 65535
    ? category
    : null;
}

/** One exercise: the sessions it was done in, each with its best set and estimated one-rep max. */
function ExercisePane({
  known,
  detail,
}: {
  known: boolean;
  detail: Methods['strength.exercise']['result'] | undefined;
}) {
  const { t } = useTranslation();
  const labels = useTableLabels();
  // The engine lists the newest session first; the chart reads oldest to newest.
  const sessions = known ? (detail?.sessions ?? []) : [];
  const oldestFirst = [...sessions].reverse();
  const columns: Column<Session>[] = [
    { key: 'date', header: t('connectPage.strength.colDate'), cell: (row) => dayOf(row.date) },
    {
      key: 'activity',
      header: t('connectPage.strength.colActivity'),
      clip: true,
      cell: (row) => row.activityName,
    },
    {
      key: 'best',
      header: t('connectPage.strength.colBestSet'),
      cell: (row) => {
        const weight = row.bestSet.weightKg == null ? null : `${row.bestSet.weightKg} kg`;
        const reps =
          row.bestSet.repetitions == null
            ? null
            : t('connectPage.strength.bestSetReps', { count: row.bestSet.repetitions });
        return [weight, reps].filter(Boolean).join(' × ');
      },
    },
    {
      key: 'max',
      header: t('connectPage.strength.colOneRepMax'),
      numeric: true,
      cell: (row) =>
        row.estimatedOneRepMaxKg == null ? '' : `${Math.round(row.estimatedOneRepMaxKg)} kg`,
    },
  ];
  return (
    <section id="exercise">
      {known ? null : <EmptyState title={t('connectPage.strength.unknownExercise')} />}
      {oldestFirst.length > 0 ? (
        <div id="exercise-chart">
          <Chart
            kind="line"
            categories={oldestFirst.map((entry) => dayOf(entry.date))}
            series={[
              {
                name: t('connectPage.strength.colBestSet'),
                colour: 'var(--colour-chart-series)',
                values: oldestFirst.map((entry) => entry.bestSet.weightKg ?? null),
              },
              {
                name: t('connectPage.strength.colOneRepMax'),
                colour: 'var(--colour-chart-muted)',
                values: oldestFirst.map((entry) => entry.estimatedOneRepMaxKg ?? null),
              },
            ]}
            x={{ values: oldestFirst.map((entry) => entry.date * 1000), kind: 'time' }}
            format={(value) => `${Math.round(value * 10) / 10} kg`}
            yTitle="kg"
            label={detail?.exerciseName ?? t('connectPage.strength.exercise')}
            empty={t('connectPage.strength.unknownExercise')}
            none="–"
          />
        </div>
      ) : null}
      <DataTable
        label={t('connectPage.strength.exercise')}
        tableId="exercise-sessions"
        labels={labels}
        columns={columns}
        rows={sessions}
        rowKey={(row) => row.activityId}
        rowAction="open"
        href={(row) => write({ screen: 'activity', id: row.activityId, query: [] })}
      />
    </section>
  );
}

export function ExercisePage({ route }: PageProps) {
  const category = exerciseOf(route.id);
  const read = useRead(
    'strength.exercise',
    category === null ? null : { exerciseCategory: category }
  );
  usePageName(read.data?.exerciseName);
  if (category === null) return <ExercisePane known={false} detail={undefined} />;
  return (
    <>
      {read.data === undefined ? <ExercisePane known detail={undefined} /> : null}
      <Reading read={read}>{(detail) => <ExercisePane known detail={detail} />}</Reading>
    </>
  );
}
