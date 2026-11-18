// The strength workout builder: the saved workouts and recent sessions in a pane on the left, the
// workout being built beside the exercise picker on the right. The catalogue, its search and
// ranking, last-time sets and what a saved workout holds are the phone's; this holds the list
// being built and sends it back through the link when it is saved or renamed.

import type { ParseKeys } from 'i18next';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { refusalText } from '../link';
import { go, replaceRoute, write, type Route } from '../router';
import type { ReadError } from '../query';
import { usePageName } from '../shell/pageName';
import { ReadNotice } from '../shell/StatePanes';
import { useTableLabels } from '../tableLabels';
import { filterCount, readFilterText, withFilterText } from '../ui/filterText';
import { useFilterDraft, useLastAnswered } from '../useFilterDraft';
import { useBatch } from '../useBatch';
import { useQueries, useRead, useWrite } from '../useRead';
import type { Methods } from '../schema';
import { settledNow, wallSeconds } from '../fitness';
import {
  Button,
  Chip,
  ChipGroup,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  Select,
  SplitPane,
  TextField,
  type Column,
} from '../ui';
import {
  blankDraft,
  canSave,
  editedSet,
  exerciseKey,
  fromGroup,
  fromWorkout,
  movedExercise,
  movedTo,
  namesOf,
  openingPicker,
  pickerAsk,
  restoreAsk,
  saveAsk,
  setsOfSame,
  toggledEquipment,
  typedNumber,
  withExercise,
  withoutExercise,
  withoutSet,
  withSet,
  withSetsFrom,
  type Draft,
  type DraftExercise,
  type PickerRow,
  type PickerState,
} from '../workoutBuilder';

type Groups = Methods['strength.groups']['result']['groups'];
type Group = Groups[number];
type Workouts = Methods['strength.workouts']['result']['workouts'];
type Workout = Workouts[number];
type Picker = Methods['strength.picker']['result'];

const NO_ROWS: Picker['rows'] = [];

/** The reads a workout write changes. */
const WORKOUT_READS = ['strength.workouts', 'strength.workout'];

/** The fields of a set, in the order Enter and Tab move through them. */
const SET_FIELDS = [
  ['reps', 'connectPage.workouts.reps'],
  ['weightKg', 'connectPage.workouts.kg'],
  ['durationSecs', 'connectPage.workouts.secs'],
] as const;

type SetKey = (typeof SET_FIELDS)[number][0];

const fieldId = (exercise: number, set: number, key: SetKey) => `set-${exercise}-${set}-${key}`;

/** One read of the query layer: the value, or null until it arrives or when it fails, and why. */
function useLoaded<T>(
  method: keyof Methods,
  params: object | null,
  pick: (answer: never) => T = (answer) => answer as T
): { value: T | null; failed: boolean; error: ReadError | null } {
  const read = useRead(method, params as never);
  const answer = read.data;
  const value = useMemo(
    () => (answer === undefined ? null : pick(answer as never)),
    // `pick` is a new function each render; the answer is what it reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [answer]
  );
  return { value, failed: read.error !== null && answer === undefined, error: read.error };
}

/** What a failed read shows in place: the update notice for a phone without the method. */
function Failed({ error }: { error: ReadError | null }) {
  const { t } = useTranslation();
  return error?.kind === 'unsupported' ? (
    <ReadNotice error={error} />
  ) : (
    <ErrorState title={t('connectPage.workouts.failed')} />
  );
}

/**
 * A number field that keeps what is typed, so `42.` stays while the next digit is on its way, and
 * hands the draft a value only when the text is one. A value changed from outside replaces the text.
 */
function SetField(props: {
  id: string;
  label: string;
  value: number | null;
  onCommit: (value: number | null) => void;
  onEnter: () => void;
}) {
  const [typedText, setText] = useState(props.value === null ? '' : String(props.value));
  const text =
    typedNumber(typedText) === props.value
      ? typedText
      : props.value === null
        ? ''
        : String(props.value);
  return (
    <TextField
      id={props.id}
      hideLabel
      label={props.label}
      inputMode="decimal"
      value={text}
      onChange={(next) => {
        const value = typedNumber(next);
        if (value === undefined) return;
        setText(next);
        props.onCommit(value);
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        props.onEnter();
      }}
    />
  );
}

export function WorkoutsPage({ route }: { route: Route }) {
  const { t } = useTranslation();
  const { run: sendWrite } = useWrite();
  const queries = useQueries();
  const batch = useBatch(queries, t('connectPage.workouts.failed'), WORKOUT_READS);
  const labels = useTableLabels();
  const editing = route.screen === 'workout' ? route.id : null;
  // Held for the visit, so the picker's key does not move on every render.
  const now = useMemo(() => Math.floor(wallSeconds(settledNow())), []);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [picker, setPicker] = useState<PickerState>(openingPicker);
  const [saving, setSaving] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ category: number; name: number | null } | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<readonly Workout[]>([]);
  const focusAfter = useRef<string | null>(null);
  // A refused delete shows where the other refusals do, once, when the batch reports it.
  const [seenRefusal, setSeenRefusal] = useState<string | null>(null);
  if (batch.refusal !== seenRefusal) {
    setSeenRefusal(batch.refusal);
    if (batch.refusal !== null) setRefused(batch.refusal);
  }
  usePageName(editing === null ? null : draft.name.trim() || null);

  const workouts = useLoaded<Workouts>(
    'strength.workouts',
    {},
    (answer: { workouts: Workouts }) => answer.workouts
  );
  const groups = useLoaded<Groups>(
    'strength.groups',
    { nowWallSeconds: now },
    (answer: { groups: Groups }) => answer.groups
  );
  const filterText = readFilterText(route);
  const [typedFilter, setTypedFilter] = useFilterDraft(filterText, (text) =>
    replaceRoute(withFilterText(route, text))
  );
  const asked = pickerAsk({ ...picker, query: filterText.trim() }, draft, now);
  const list = useLoaded<Picker>('strength.picker', asked);
  // A new filter's rows are on their way: the table, and the field in its toolbar, stay mounted
  // with the rows already held, so typing is not interrupted.
  const shownList = useLastAnswered(list.value ?? undefined);
  // The whole catalogue is read once so a loaded exercise has its name.
  const catalogue = useLoaded<Picker>('strength.picker', {
    equipment: [],
    query: '',
    nowWallSeconds: now,
  });
  const names = useMemo(() => namesOf(catalogue.value?.rows ?? NO_ROWS), [catalogue.value]);

  // Opening a workout from the address starts the draft from it. The page is
  // keyed by the address, so a different workout is a fresh page.
  const opened = useRead('strength.workout', editing === null ? null : { id: editing });
  const openedWorkout = opened.data?.workout;
  const [startedFrom, setStartedFrom] = useState<unknown>(null);
  if (openedWorkout && openedWorkout !== startedFrom) {
    setStartedFrom(openedWorkout);
    setDraft(fromWorkout(openedWorkout));
  }

  // The last-time sets of the exercise being added: the read lands in the draft once.
  const last = useRead(
    'strength.lastTime',
    adding === null ? null : { ...adding, nowWallSeconds: now }
  );
  if (adding !== null && last.data !== undefined) {
    setDraft((held) =>
      withExercise(held, adding.category, adding.name, last.data?.lastTime?.sets ?? [])
    );
    setAdding(null);
  }

  // A set added by Enter takes the keyboard once it is on the page.
  useEffect(() => {
    const id = focusAfter.current;
    focusAfter.current = null;
    if (id !== null) document.getElementById(id)?.focus();
  }, [draft]);

  const nameFor = (category: number, name: number | null) =>
    names.get(exerciseKey(category, name)) ?? t('connectPage.workouts.unnamedExercise');
  const groupName = (group: { exercises: DraftExercise[] }) =>
    group.exercises.map((exercise) => nameFor(exercise.category, exercise.name)).join(', ');

  const add = (category: number, name: number | null) => {
    if (last.error) last.retry();
    setAdding({ category, name });
  };

  const save = async () => {
    setSaving(true);
    setRefused(null);
    try {
      const { result } = await sendWrite('strength.saveWorkout', saveAsk(draft), {
        invalidates: ['strength.workouts', 'strength.workout'],
      });
      go({ screen: 'workout', id: result.id, query: [] });
    } catch (error) {
      setRefused(refusalText(error, t));
    } finally {
      setSaving(false);
    }
  };

  const rename = async () => {
    if (draft.id === null || draft.name.trim() === '') return;
    setRefused(null);
    try {
      await sendWrite(
        'strength.renameWorkout',
        { id: draft.id, name: draft.name.trim() },
        { invalidates: ['strength.workouts', 'strength.workout'] }
      );
    } catch (error) {
      setRefused(refusalText(error, t));
    }
  };

  const remove = async (rows: readonly Workout[]) => {
    setDeleting([]);
    setRefused(null);
    // What the phone holds is read before any delete, because a delete leaves nothing to restore from.
    let held: Methods['strength.workout']['result']['workout'][];
    try {
      held = await Promise.all(
        rows.map(async (row) => (await queries.fetch('strength.workout', { id: row.id })).workout)
      );
    } catch (error) {
      setRefused(refusalText(error, t));
      return;
    }
    const deleted = await batch.run(
      rows.map((row) => ({ method: 'strength.deleteWorkout', params: { id: row.id } })),
      t('connectPage.workouts.deleted', { count: rows.length }),
      // The accepted deletes are the first answers, and a workout the phone no longer held has nothing to restore.
      (answers) =>
        rows.flatMap((row, at) => {
          const content = held[at];
          return at < answers.length && content
            ? [{ method: 'strength.restoreWorkout' as const, params: restoreAsk(row, content) }]
            : [];
        }),
      t('connectPage.workouts.undo')
    );
    if (deleted && editing !== null && rows.some((row) => row.id === editing)) {
      go({ screen: 'workouts', id: null, query: [] });
    }
  };

  const sources = (groups.value ?? []).map((group) => ({ exercises: group.exercises }));

  const savedColumns: Column<Workout>[] = [
    { key: 'name', header: t('connectPage.columns.name'), clip: true, cell: (row) => row.name },
    {
      key: 'exercises',
      header: t('connectPage.strength.colExercises'),
      numeric: true,
      cell: (row) => String(row.exerciseCount),
    },
    {
      key: 'sets',
      header: t('connectPage.strength.colSets'),
      numeric: true,
      cell: (row) => String(row.setCount),
    },
  ];
  const recentColumns: Column<Group>[] = [
    {
      key: 'exercises',
      header: t('connectPage.strength.colExercises'),
      clip: true,
      cell: groupName,
    },
    {
      key: 'times',
      header: t('connectPage.workouts.recent'),
      numeric: true,
      cell: (row) => t('connectPage.workouts.times', { times: row.times }),
    },
  ];
  const pickerColumns: Column<PickerRow>[] = [
    {
      key: 'name',
      header: t('connectPage.workouts.picker'),
      clip: true,
      cell: (row) => row.displayName,
    },
    {
      key: 'last',
      header: t('connectPage.workouts.colLastDone'),
      numeric: true,
      cell: (row) =>
        row.lastDoneDays === null
          ? ''
          : t('connectPage.workouts.daysAgo', { days: row.lastDoneDays }),
    },
  ];

  return (
    <section id="workouts">
      <SplitPane
        label={t('connectPage.workouts.heading')}
        storageKey="workouts-split"
        defaultWidth={340}
        minWidth={260}
        maxWidth={560}
        first={
          <div className="workouts-library">
            <div className="workouts-heading">
              <h2>{t('connectPage.workouts.saved')}</h2>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => go({ screen: 'workouts', id: null, query: [] })}
              >
                {t('connectPage.workouts.blank')}
              </Button>
            </div>
            {workouts.failed ? <Failed error={workouts.error} /> : null}
            {workouts.value?.length === 0 ? (
              <EmptyState title={t('connectPage.workouts.noneSaved')} />
            ) : (
              <DataTable
                label={t('connectPage.workouts.saved')}
                tableId="workouts-saved"
                labels={labels}
                columns={savedColumns}
                rows={workouts.value ?? []}
                rowKey={(row) => row.id}
                selectedKey={editing}
                rowAction="open"
                href={(row) => write({ screen: 'workout', id: row.id, query: [] })}
                selectable
                bulkActions={[
                  {
                    key: 'delete',
                    label: t('connectPage.workouts.delete'),
                    run: (rows) => setDeleting(rows),
                  },
                ]}
              />
            )}
            <h2>{t('connectPage.workouts.recent')}</h2>
            <DataTable
              label={t('connectPage.workouts.recent')}
              tableId="workouts-groups"
              labels={labels}
              columns={recentColumns}
              rows={groups.value ?? []}
              rowKey={(row) => row.signature}
              onRowClick={(row) => setDraft(fromGroup(row))}
              onOpen={(row) => setDraft(fromGroup(row))}
            />
          </div>
        }
        second={
          <div className="workouts-editor-pane">
            <div className="workouts-editor">
              <div className="workouts-name">
                <TextField
                  id="workout-name"
                  type="text"
                  label={t('connectPage.workouts.name')}
                  value={draft.name}
                  onChange={(name) => setDraft({ ...draft, name })}
                />
                {draft.id === null ? null : (
                  <Button
                    variant="secondary"
                    disabled={draft.name.trim() === ''}
                    onClick={() => void rename()}
                  >
                    {t('connectPage.routes.actionRename')}
                  </Button>
                )}
                <Button
                  variant="primary"
                  busy={saving}
                  disabled={!canSave(draft) || saving}
                  onClick={() => void save()}
                >
                  {t('connectPage.workouts.save')}
                </Button>
              </div>
              {adding !== null && last.error ? (
                <div id="workout-add-failed">
                  <Failed error={last.error} />
                </div>
              ) : null}
              {opened.error ? <Failed error={opened.error} /> : null}
              {refused ? <ErrorState title={refused} /> : null}
              {draft.exercises.length === 0 ? (
                <EmptyState title={t('connectPage.workouts.empty')} />
              ) : null}
              <ol id="workout-exercises">
                {draft.exercises.map((exercise, at) => (
                  <li
                    key={`${at}-${exercise.category}-${exercise.name}`}
                    className="workout-exercise"
                    draggable
                    data-over={over === at && dragging !== at ? true : undefined}
                    data-dragging={dragging === at || undefined}
                    onDragStart={() => setDragging(at)}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setOver(at);
                    }}
                    onDragEnd={() => {
                      setDragging(null);
                      setOver(null);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (dragging !== null) setDraft(movedTo(draft, dragging, at));
                      setDragging(null);
                      setOver(null);
                    }}
                  >
                    <header className="workout-exercise-head">
                      <h3>{nameFor(exercise.category, exercise.name)}</h3>
                      <div className="workout-exercise-actions">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDraft(movedExercise(draft, at, -1))}
                        >
                          {t('connectPage.workouts.up')}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setDraft(movedExercise(draft, at, 1))}
                        >
                          {t('connectPage.workouts.down')}
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => setDraft(withoutExercise(draft, at))}
                        >
                          {t('connectPage.workouts.removeExercise')}
                        </Button>
                      </div>
                    </header>
                    <table className="workout-sets">
                      <thead>
                        <tr>
                          <th scope="col">{t('strength.setColumn')}</th>
                          {SET_FIELDS.map(([key, label]) => (
                            <th key={key} scope="col">
                              {t(label as ParseKeys)}
                            </th>
                          ))}
                          <td />
                        </tr>
                      </thead>
                      <tbody>
                        {exercise.sets.map((set, index) => (
                          <tr key={index}>
                            <td>{index + 1}</td>
                            {SET_FIELDS.map(([key, label], column) => (
                              <td key={key}>
                                <SetField
                                  id={fieldId(at, index, key)}
                                  label={t(label as ParseKeys)}
                                  value={set[key] ?? null}
                                  onCommit={(value) =>
                                    setDraft(editedSet(draft, at, index, key, value))
                                  }
                                  onEnter={() => {
                                    const next = SET_FIELDS[column + 1];
                                    if (next) {
                                      document.getElementById(fieldId(at, index, next[0]))?.focus();
                                    } else if (index + 1 < exercise.sets.length) {
                                      document
                                        .getElementById(fieldId(at, index + 1, 'reps'))
                                        ?.focus();
                                    } else {
                                      focusAfter.current = fieldId(at, index + 1, 'reps');
                                      setDraft(withSet(draft, at));
                                    }
                                  }}
                                />
                              </td>
                            ))}
                            <td>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setDraft(withoutSet(draft, at, index))}
                              >
                                {t('connectPage.workouts.removeSet')}
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="workout-exercise-tools">
                      <Button size="sm" onClick={() => setDraft(withSet(draft, at))}>
                        {t('connectPage.workouts.addSet')}
                      </Button>
                      <Select
                        label={t('connectPage.workouts.copyFrom')}
                        value=""
                        options={[
                          { value: '', label: t('connectPage.workouts.chooseSession') },
                          ...sources.flatMap((source, index) =>
                            setsOfSame(source.exercises, exercise).length > 0
                              ? [{ value: String(index), label: groupName(source) }]
                              : []
                          ),
                        ]}
                        onChange={(picked) => {
                          const source = sources[Number(picked)];
                          if (source)
                            setDraft(
                              withSetsFrom(draft, at, setsOfSame(source.exercises, exercise))
                            );
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <aside className="workouts-picker" aria-label={t('connectPage.workouts.picker')}>
              <ChipGroup label={t('connectPage.workouts.equipment')}>
                {(shownList?.equipment ?? []).map((slug) => (
                  <Chip
                    key={slug}
                    selected={picker.equipment.includes(slug)}
                    onToggle={() => setPicker(toggledEquipment(picker, slug))}
                  >
                    {slug}
                  </Chip>
                ))}
              </ChipGroup>
              {list.failed ? <Failed error={list.error} /> : null}
              <DataTable
                label={t('connectPage.workouts.picker')}
                tableId="workout-picker"
                labels={labels}
                filter={{
                  id: 'workout-search',
                  label: t('connectPage.filter.exercises'),
                  clearLabel: t('connectPage.filter.clear'),
                  value: typedFilter,
                  onChange: setTypedFilter,
                  count:
                    shownList === undefined || catalogue.value === null
                      ? null
                      : filterCount(shownList.rows.length, catalogue.value.rows.length),
                  countText: (count) => t('connectPage.filter.count', count),
                }}
                columns={pickerColumns}
                rows={shownList?.rows ?? NO_ROWS}
                rowKey={(row) => exerciseKey(row.category, row.name)}
                onRowClick={(row) => void add(row.category, row.name)}
                onOpen={(row) => void add(row.category, row.name)}
              />
            </aside>
          </div>
        }
      />
      <ConfirmDialog
        open={deleting.length > 0}
        title={t('connectPage.workouts.confirmDelete', {
          name: deleting.map((row) => row.name).join(', '),
        })}
        description={t('connectPage.workouts.confirmDeleteBody')}
        confirmLabel={t('connectPage.workouts.delete')}
        cancelLabel={t('connectPage.workouts.cancel')}
        variant="destructive"
        onConfirm={() => void remove(deleting)}
        onClose={() => setDeleting([])}
      />
    </section>
  );
}
