// The strength session being recorded on the phone, followed from the browser:
// the set to do now, the rest countdown, the neighbouring exercises and the
// whole list. The phone records; the engine applies a tick or an edit from
// either side in order, and this redraws from what the engine answers.

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { refusalText } from '../link';
import { ReadNotice } from '../shell/StatePanes';
import { useQueries, useRead } from '../useRead';
import { Button, Card, DataTable, EmptyState, ErrorState, SplitPane, TextField } from '../ui';
import type { Column } from '../ui';
import {
  clock,
  completeSet,
  liveEdit,
  reopenSet,
  restRemaining,
  typedSet,
  typedValue,
  type LiveAnswer,
  type LiveEdit,
} from '../liveSession';

export function LivePage({ nowSeconds = () => Date.now() / 1000 }: { nowSeconds?: () => number }) {
  const { t } = useTranslation();
  const queries = useQueries();
  const liveRead = useRead('strength.live', {} as never);
  const answer = (liveRead.data as LiveAnswer | undefined) ?? null;
  const failed = liveRead.error !== null && answer === null;
  const [refused, setRefused] = useState<string | null>(null);
  const [now, setNow] = useState(() => nowSeconds());

  const resting = answer?.focus?.phase === 'rest';
  useEffect(() => {
    if (!resting) return undefined;
    const tick = setInterval(() => setNow(nowSeconds()), 500);
    return () => clearInterval(tick);
  }, [resting, nowSeconds]);

  const edit = useCallback(
    async (change: LiveEdit) => {
      setRefused(null);
      try {
        // The edit reads the session again, so the page redraws from what the engine answers.
        await queries.write(
          'strength.liveEdit',
          { edit: change },
          { invalidates: ['strength.live'] }
        );
      } catch (error) {
        setRefused(refusalText(error, t));
      }
    },
    [queries, t]
  );

  // Each cell's last text sent or shown, so Enter then the blur it causes sends once.
  const settled = useRef(new Map<string, string>());
  const cells = useRef(new Map<string, HTMLInputElement>());

  const typed = (
    at: number,
    index: number,
    field: 'reps' | 'weight',
    text: string,
    shown: string
  ) => {
    const id = `${at}:${index}:${field}`;
    if (text === (settled.current.get(id) ?? shown)) return;
    const value = typedValue(text);
    if (value === undefined) return;
    settled.current.set(id, text);
    void edit(typedSet(at, index, field, value));
  };

  const live = answer?.session ?? null;
  const focus = answer?.focus ?? null;
  const left = restRemaining(focus, now);
  const current = focus?.current ?? null;
  const here =
    live && live.currentExercise !== null && live.currentSet !== null
      ? { exercise: live.currentExercise, set: live.currentSet }
      : null;

  type SetRow = {
    key: string;
    at: number;
    index: number;
    first: boolean;
    done: number;
    count: number;
    set: NonNullable<typeof live>['exercises'][number]['sets'][number];
    name: string;
  };
  const rows: SetRow[] = (live?.exercises ?? []).flatMap((exercise, at) =>
    exercise.sets.map((set, index) => ({
      key: `${at}:${index}`,
      at,
      index,
      first: index === 0,
      done: exercise.sets.filter((each) => each.done).length,
      count: exercise.sets.length,
      set,
      name: exercise.displayName,
    }))
  );

  const cell = (row: SetRow, field: 'reps' | 'weight') => {
    const shown = String((field === 'reps' ? row.set.reps : row.set.displayWeight) ?? '');
    const id = `${row.at}:${row.index}:${field}`;
    const move = (event: KeyboardEvent<HTMLInputElement>) => {
      const input = event.currentTarget;
      if (event.key === 'Escape') {
        event.preventDefault();
        input.value = shown;
        settled.current.delete(id);
        input.blur();
      } else if (event.key === 'Enter') {
        event.preventDefault();
        typed(row.at, row.index, field, input.value, shown);
        const at = rows.findIndex((each) => each.key === row.key);
        const next = rows[at + 1];
        if (next) {
          const target = cells.current.get(`${next.at}:${next.index}:${field}`);
          target?.focus();
          target?.select?.();
        }
      }
    };
    return (
      <TextField
        hideLabel
        data-cell={field}
        label={
          field === 'reps'
            ? t('connectPage.workouts.reps')
            : t('connectPage.live.weight', { unit: live?.weightUnit ?? '' })
        }
        inputMode="decimal"
        defaultValue={shown}
        key={`${field}${shown}`}
        inputRef={(element) => {
          if (element) cells.current.set(id, element);
          else cells.current.delete(id);
        }}
        onKeyDown={move}
        onBlur={(event) => typed(row.at, row.index, field, event.currentTarget.value, shown)}
      />
    );
  };

  const columns: Column<SetRow>[] = [
    {
      key: 'exercise',
      header: t('connectPage.live.exercise'),
      clip: true,
      cell: (row) => (row.first ? `${row.name} · ${row.done}/${row.count}` : ''),
    },
    { key: 'set', header: t('connectPage.live.set'), numeric: true, cell: (row) => row.index + 1 },
    { key: 'reps', header: t('connectPage.workouts.reps'), cell: (row) => cell(row, 'reps') },
    {
      key: 'weight',
      header: t('connectPage.live.weight', { unit: live?.weightUnit ?? '' }),
      cell: (row) => cell(row, 'weight'),
    },
    {
      key: 'done',
      header: t('connectPage.live.tick'),
      cell: (row) => (
        <Button
          size="sm"
          variant={row.set.done ? 'secondary' : 'ghost'}
          onClick={() =>
            void edit(row.set.done ? reopenSet(row.at, row.index) : completeSet(row.at, row.index))
          }
        >
          {row.set.done ? t('connectPage.live.reopen') : t('connectPage.live.tick')}
        </Button>
      ),
    },
  ];

  const liveExercise = here && live ? live.exercises[here.exercise] : null;

  return (
    <section id="live">
      {failed && liveRead.error?.kind === 'unsupported' ? (
        <ReadNotice error={liveRead.error} />
      ) : null}
      {failed && liveRead.error?.kind !== 'unsupported' ? (
        <ErrorState title={t('connectPage.live.failed')} />
      ) : null}
      {answer && !live ? <EmptyState title={t('connectPage.live.none')} /> : null}
      {refused ? <p id="live-refused">{refused}</p> : null}
      {live && focus ? (
        <SplitPane
          label={t('connectPage.live.divider')}
          storageKey="live-split"
          defaultWidth={760}
          minWidth={480}
          maxWidth={1400}
          first={
            <div id="live-sets">
              <DataTable
                label={t('connectPage.live.all')}
                tableId="live-sets-table"
                columns={columns}
                rows={rows}
                rowKey={(row) => row.key}
                rowProps={(row) => ({
                  'data-done': row.set.done,
                  'data-live': here?.exercise === row.at && here?.set === row.index,
                  'data-group-start': row.first,
                })}
              />
            </div>
          }
          second={
            <Card label={t('connectPage.live.now')}>
              {current && here ? (
                <div id="live-current">
                  <h2 id="live-exercise">{liveExercise?.displayName}</h2>
                  <p id="live-set">
                    {t('connectPage.live.setOf', { set: current.setNumber, of: current.setCount })}
                  </p>
                  <p id="live-values">
                    {current.reps ?? '–'} × {current.displayWeight ?? '–'} {current.weightUnit}
                  </p>
                  <Button
                    id="live-tick"
                    onClick={() => void edit(completeSet(here.exercise, here.set))}
                  >
                    {t('connectPage.live.tick')}
                  </Button>
                </div>
              ) : (
                <p id="live-finished">{t('connectPage.live.finished')}</p>
              )}
              {left !== null ? (
                <p id="live-rest">
                  {t('connectPage.live.rest', { time: clock(left) })}{' '}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => void edit(liveEdit('endRest'))}
                  >
                    {t('connectPage.live.endRest')}
                  </Button>
                </p>
              ) : (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void edit(liveEdit('startRest'))}
                >
                  {t('connectPage.live.startRest')}
                </Button>
              )}
              <p id="live-neighbours">
                {focus.previous
                  ? t('connectPage.live.previous', {
                      done: focus.previous.setsDone,
                      of: focus.previous.setCount,
                    })
                  : null}{' '}
                {focus.next
                  ? t('connectPage.live.next', {
                      done: focus.next.setsDone,
                      of: focus.next.setCount,
                    })
                  : null}
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void edit(
                    liveEdit('addSet', { exercise: here?.exercise ?? rows.at(-1)?.at ?? 0 })
                  )
                }
              >
                {t('connectPage.workouts.addSet')}
              </Button>
            </Card>
          }
        />
      ) : null}
    </section>
  );
}
