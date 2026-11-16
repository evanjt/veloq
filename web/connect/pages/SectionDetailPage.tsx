// One section: its line and passes on the map beside the performance views, the
// laps with their bulk edits, the ledger of what changed and the sections it
// could merge with. The address holds the sport, range, direction and tab. The
// engine computes every figure; this places it and sends the athlete's edits.

import type { TFunction } from 'i18next';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { changeCopy } from '@/features/routes/lib/sectionChangeCopy';

import { Chart } from '../charts/Chart';
import { distanceUnit, distanceValue, elapsed, km, kmh, metricUnits } from '../format';
import { pointsOf as trackPoints } from '../preview';
import { SectionMap } from '../map/SectionMap';
import { go, queryValue, withQuery, type Route } from '../router';
import { historyRowsOf } from '../routesDetail';
import {
  askOf,
  binsOf,
  candidatesByOverlap,
  deltaCurvesOf,
  directionsOf,
  isRange,
  OPENING_RANGE,
  pointsOf,
  RANGES,
  statsOf,
  type Candidate,
  type Direction,
  type Performance,
  type RangeId,
} from '../sectionDetail';
import {
  excludeActivities,
  excludeLaps,
  includeActivities,
  includeLaps,
  lapRows,
  undoOf,
  type LapRow,
  type LapWrite,
} from '../sectionLaps';
import { resetReferenceWrite, setReferenceWrite, undoOfEdit } from '../sectionBounds';
import { usePageName } from '../shell/pageName';
import { Reading } from '../shell/StatePanes';
import { useTableLabels } from '../tableLabels';
import {
  Badge,
  Button,
  Card,
  Chip as ChipToggle,
  ConfirmDialog,
  ContextMenu,
  DataTable,
  Dialog,
  EmptyState,
  SegmentedControl,
  Tabs,
  TextField,
  ToastProvider,
  Tooltip,
  useToast,
  type BulkAction,
  type Column,
} from '../ui';
import { useBatch, type Batch, type Write } from '../useBatch';
import { useQueries, useRead } from '../useRead';
import type { QueryClient } from '../query';
import type { Methods } from '../schema';
import { useBoundsEditing } from './SectionBoundsEditor';
import { StatusBadges } from './SectionParts';
import { statusOf } from '../sectionsList';

type Detail = Methods['section.detail']['result'];
type Section = NonNullable<Detail['section']>;

const NO_NAME = 'connectPage.routes.unnamedSection';

const dateOf = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

export function SectionDetailPage({ route }: { route: Route }) {
  const { t } = useTranslation();
  if (!route.id) return null;
  return (
    <ToastProvider dismissLabel={t('connectPage.sections.dismiss')}>
      <SectionDetail route={route} id={route.id} />
    </ToastProvider>
  );
}

function SectionDetail({ route, id }: { route: Route; id: string }) {
  const { t } = useTranslation();
  const phone = useQueries();
  const detail = useRead('section.detail', { id });
  const section = detail.data?.section ?? null;
  usePageName(section?.name);
  const batch = useBatch(phone, t('connectPage.routes.editFailed'));
  const editing = useBoundsEditing({
    id,
    section,
    hasOriginalBounds: detail.data?.hasOriginalBounds ?? false,
    phone,
    batch,
  });

  const sportParam = queryValue(route, 'sport');
  const rangeParam = queryValue(route, 'range');
  const range: RangeId = isRange(rangeParam) ? rangeParam : OPENING_RANGE;
  const performance = useRead('section.performance', askOf(id, range, sportParam));
  const [hoveredActivity, setHoveredActivity] = useState<string | null>(null);
  const [litCandidate, setLitCandidate] = useState<string | null>(null);
  // Versions belong to the section they were chosen on, so another section starts with none.
  const [chosen, setChosen] = useState<{ id: string; versions: readonly number[] }>({
    id,
    versions: [],
  });
  const shownVersions = chosen.id === id ? chosen.versions : [];
  const toggleVersion = (version: number) =>
    setChosen({
      id,
      versions: shownVersions.includes(version)
        ? shownVersions.filter((n) => n !== version)
        : [...shownVersions, version],
    });

  const candidates = useMemo(
    () => candidatesByOverlap(detail.data?.mergeCandidates ?? []),
    [detail.data?.mergeCandidates]
  );
  const lines = useMemo(
    () =>
      candidates.map((candidate) => ({
        id: candidate.sectionId,
        points: trackPoints(candidate.encodedPolyline),
      })),
    [candidates]
  );
  const change = (changes: Record<string, string | null>) => go(withQuery(route, changes));
  const asked = queryValue(route, 'dir');
  const chooseDirection = (next: Direction) => change({ dir: next === 'forward' ? null : next });

  return (
    <section id="section-page">
      <div id="section-map" className="pane" aria-label={t('connectPage.activity.map')}>
        <SectionMap
          queries={phone}
          id={id}
          hoveredActivity={hoveredActivity}
          selected={[]}
          candidates={lines}
          versions={shownVersions}
          litCandidate={litCandidate}
          onHoverActivity={setHoveredActivity}
          onHoverCandidate={setLitCandidate}
          onPickCandidate={(candidateId) => change({ tab: 'merge', candidate: candidateId })}
          editor={editing.map}
        />
      </div>
      <div id="section-body" className="pane">
        <Reading read={detail}>
          {(data) =>
            data.section ? (
              <>
                <Header
                  id={id}
                  section={data.section}
                  batch={batch}
                  performance={performance.data ?? null}
                  sport={sportParam}
                  range={range}
                  onSport={(sport) => change({ sport })}
                  onRange={(next) => change({ range: next === OPENING_RANGE ? null : next })}
                  onEditBounds={editing.active ? null : editing.begin}
                />
                {editing.panel}
                {batch.refusal ? (
                  <p className="notice" role="alert">
                    {batch.refusal}
                  </p>
                ) : null}
                <Tabs
                  label={t('connectPage.sections.views')}
                  items={[
                    {
                      id: 'time',
                      label: t('connectPage.sections.overTime'),
                      panel: (
                        <Reading read={performance}>
                          {(data) => (
                            <OverTime performance={data} asked={asked} choose={chooseDirection} />
                          )}
                        </Reading>
                      ),
                    },
                    {
                      id: 'spread',
                      label: t('connectPage.sections.spread'),
                      panel: (
                        <Reading read={performance}>
                          {(data) => (
                            <Spread performance={data} asked={asked} choose={chooseDirection} />
                          )}
                        </Reading>
                      ),
                    },
                    {
                      id: 'delta',
                      label: t('connectPage.sections.aheadBehind'),
                      panel: (
                        <Reading read={performance}>
                          {(data) => (
                            <AheadBehind
                              performance={data}
                              asked={asked}
                              choose={chooseDirection}
                            />
                          )}
                        </Reading>
                      ),
                    },
                    {
                      id: 'laps',
                      label: t('connectPage.sections.laps'),
                      panel: (
                        <Reading read={performance}>
                          {(data) => (
                            <Laps
                              id={id}
                              performance={data}
                              excluded={detail.data?.excludedActivityIds ?? []}
                              batch={batch}
                              phone={phone}
                              onHover={setHoveredActivity}
                            />
                          )}
                        </Reading>
                      ),
                    },
                    {
                      id: 'history',
                      label: t('connectPage.sections.history'),
                      panel: <History id={id} shown={shownVersions} onToggle={toggleVersion} />,
                    },
                    {
                      id: 'merge',
                      label: t('connectPage.sections.mergeCandidates', {
                        count: candidates.length,
                      }),
                      panel: (
                        <MergeCandidates
                          id={id}
                          kept={data.section}
                          candidates={candidates}
                          selected={queryValue(route, 'candidate')}
                          lit={litCandidate}
                          phone={phone}
                          onLit={setLitCandidate}
                          onSelect={(candidate) => change({ candidate })}
                        />
                      ),
                    },
                  ]}
                />
              </>
            ) : (
              <Retired detail={data} id={id} batch={batch} />
            )
          }
        </Reading>
      </div>
    </section>
  );
}

/** A section's type in words. */
function typeName(t: TFunction, type: string): string {
  if (type === 'auto') return t('connectPage.sections.typeAuto');
  if (type === 'custom') return t('connectPage.sections.typeCustom');
  return t('connectPage.sections.typeOther');
}

function Header({
  id,
  section,
  batch,
  performance,
  sport,
  range,
  onSport,
  onRange,
  onEditBounds,
}: {
  id: string;
  section: Section;
  batch: Batch;
  performance: Performance | null;
  sport: string | null;
  range: RangeId;
  onSport: (sport: string | null) => void;
  onRange: (range: RangeId) => void;
  /** Opens the bounds editor; null while it is open. */
  onEditBounds: (() => void) | null;
}) {
  const { t } = useTranslation();
  const name = section.name ?? '';
  const [unflagging, setUnflagging] = useState(false);
  const run = (writes: Write[], message: string, undo: Write[]) =>
    batch.run(writes, message, undo, t('connectPage.sections.undo'));
  const sports = performance?.sportCounts ?? [];
  const chosen = sport ?? performance?.sportType ?? sports[0]?.sportType ?? null;
  return (
    <header className="section-header">
      <div className="section-title">
        <InlineName
          key={name}
          value={name}
          placeholder={t(NO_NAME)}
          label={t('connectPage.routes.name')}
          onSave={(next) =>
            run(
              [{ method: 'section.rename', params: { id, name: next } }],
              t('connectPage.sections.renamed', { name: next }),
              [{ method: 'section.rename', params: { id, name } }]
            )
          }
        />
        <StatusBadges status={statusOf(section)} />
        <Badge>{typeName(t, section.sectionType)}</Badge>
      </div>
      <dl className="facts section-facts">
        <dt>{t('connectPage.routes.sortDistance')}</dt>
        <dd>{km(section.distanceMeters)}</dd>
        {section.avgGradePercent === null ? null : (
          <>
            <dt>{t('connectPage.sections.grade')}</dt>
            <dd>{section.avgGradePercent.toFixed(1)} %</dd>
          </>
        )}
        {section.elevationGainM === null ? null : (
          <>
            <dt>{t('connectPage.facts.climbing')}</dt>
            <dd>{Math.round(section.elevationGainM)} m</dd>
          </>
        )}
        <dt>{t('connectPage.routes.passes')}</dt>
        <dd>{section.visitCount}</dd>
      </dl>
      <div className="section-actions">
        {section.isUserDefined ? null : (
          <Button
            variant="primary"
            onClick={() =>
              void run(
                [{ method: 'section.accept', params: { id } }],
                t('connectPage.sections.accepted', { name: name || t(NO_NAME) }),
                [{ method: 'section.unaccept', params: { ids: [id] } }]
              )
            }
          >
            {t('connectPage.routes.actionAccept')}
          </Button>
        )}
        <Tooltip text={t('connectPage.sections.liftHint')}>
          <span>
            <ChipToggle
              selected={section.isLift}
              onToggle={() =>
                section.isLift
                  ? setUnflagging(true)
                  : void run(
                      [{ method: 'section.setLift', params: { id, isLift: true } }],
                      t('connectPage.sections.liftChanged'),
                      []
                    )
              }
            >
              {t('connectPage.sections.liftGround')}
            </ChipToggle>
          </span>
        </Tooltip>
        <ConfirmDialog
          open={unflagging}
          title={t('connectPage.sections.unflagLift')}
          description={t('connectPage.sections.unflagLiftBody')}
          confirmLabel={t('connectPage.sections.unflag')}
          cancelLabel={t('connectPage.sections.cancel')}
          onConfirm={() =>
            void run(
              [{ method: 'section.setLift', params: { id, isLift: false } }],
              t('connectPage.sections.liftChanged'),
              []
            )
          }
          onClose={() => setUnflagging(false)}
        />
        <Button
          disabled={onEditBounds === null || section.disabled}
          onClick={onEditBounds ?? undefined}
        >
          {t('connectPage.sections.editBounds')}
        </Button>
        <Button
          onClick={() =>
            void run(
              [{ method: section.disabled ? 'section.enable' : 'section.disable', params: { id } }],
              t(
                section.disabled
                  ? 'connectPage.sections.restoredShort'
                  : 'connectPage.sections.removed'
              ),
              [{ method: section.disabled ? 'section.disable' : 'section.enable', params: { id } }]
            )
          }
        >
          {t(section.disabled ? 'connectPage.sections.restore' : 'connectPage.sections.remove')}
        </Button>
      </div>
      <div className="section-controls">
        {sports.length > 1 ? (
          <SegmentedControl
            label={t('connectPage.sections.sport')}
            value={chosen ?? ''}
            options={sports.map((entry) => ({
              value: entry.sportType,
              label: `${t(`activityTypes.${entry.sportType}` as never, { defaultValue: entry.sportType })} (${entry.count})`,
            }))}
            onChange={onSport}
          />
        ) : null}
        <SegmentedControl
          label={t('connectPage.sections.range')}
          value={range}
          options={RANGES.map((entry) => ({
            value: entry.id,
            label: t(`connectPage.sections.range_${entry.id}` as never),
          }))}
          onChange={onRange}
        />
      </div>
      {performance ? <Stats performance={performance} /> : null}
    </header>
  );
}

/** The name as text; a click turns it into a field, Enter saves it and Escape puts it back. */
function InlineName({
  value,
  placeholder,
  label,
  onSave,
}: {
  value: string;
  placeholder: string;
  label: string;
  onSave: (name: string) => Promise<boolean>;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  if (!editing) {
    return (
      <h2 className="panel-title section-name">
        <Tooltip text={t('connectPage.sections.renameHint')}>
          <span>
            <Button
              variant="ghost"
              aria-label={`${label}: ${value || placeholder}`}
              onClick={() => setEditing(true)}
            >
              {value || placeholder}
            </Button>
          </span>
        </Tooltip>
      </h2>
    );
  }
  const finish = (save: boolean) => {
    setEditing(false);
    const next = text.trim();
    if (save && next !== '' && next !== value) void onSave(next);
    else setText(value);
  };
  return (
    <form
      className="rename"
      onSubmit={(event) => {
        event.preventDefault();
        finish(true);
      }}
    >
      <TextField
        autoFocus
        label={label}
        hideLabel
        value={text}
        onChange={setText}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') finish(false);
        }}
      />
    </form>
  );
}

/** What the engine has of each direction in the range: laps, best, average and the latest. */
function Stats({ performance }: { performance: Performance }) {
  const { t } = useTranslation();
  const rows = statsOf(performance);
  if (rows.length === 0) return null;
  return (
    <table className="section-stats">
      <caption className="visually-hidden">{t('connectPage.sections.stats')}</caption>
      <thead>
        <tr>
          <th scope="col">{t('connectPage.sections.direction')}</th>
          <th scope="col">{t('connectPage.sections.laps')}</th>
          <th scope="col">{t('connectPage.sections.best')}</th>
          <th scope="col">{t('connectPage.sections.average')}</th>
          <th scope="col">{t('connectPage.sections.latest')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.direction}>
            <th scope="row">{t(`connectPage.sections.${row.direction}`)}</th>
            <td data-numeric>{row.count}</td>
            <td data-numeric>
              {row.best === null ? null : elapsed(row.best * 1000)}
              {row.record ? <Badge>{t('connectPage.sections.statusRecord')}</Badge> : null}
            </td>
            <td data-numeric>{row.avgTime === null ? null : elapsed(row.avgTime * 1000)}</td>
            <td>{row.last === null ? null : dateOf(row.last)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const DIRECTION_COLOURS: Record<Direction, string> = {
  forward: 'var(--colour-data-div-cool-2)',
  reverse: 'var(--colour-data-div-warm-2)',
};

/** The direction a view shows: the one the address names when the section has it, else forward. */
function directionOf(performance: Performance, asked: string | null): [Direction, Direction[]] {
  const directions = directionsOf(performance);
  return [directions.find((candidate) => candidate === asked) ?? 'forward', directions];
}

function DirectionControl({
  direction,
  directions,
  onChange,
}: {
  direction: Direction;
  directions: Direction[];
  onChange: (next: Direction) => void;
}) {
  const { t } = useTranslation();
  if (directions.length < 2) return null;
  return (
    <SegmentedControl
      label={t('connectPage.sections.direction')}
      value={direction}
      options={directions.map((entry) => ({
        value: entry,
        label: t(`connectPage.sections.${entry}`),
      }))}
      onChange={onChange}
    />
  );
}

function OverTime({
  performance,
  asked,
  choose,
}: {
  performance: Performance;
  asked: string | null;
  choose: (next: Direction) => void;
}) {
  const { t, i18n } = useTranslation();
  const [direction, directions] = directionOf(performance, asked);
  const [picked, setPicked] = useState<number | null>(null);
  const points = pointsOf(performance, direction);
  const named = picked === null ? null : points[picked];
  return (
    <div className="section-view">
      <DirectionControl direction={direction} directions={directions} onChange={choose} />
      <Chart
        kind="scatter"
        label={t('connectPage.routes.performanceChart')}
        empty={t('connectPage.routes.noAttempts')}
        none={t('connectPage.sections.noValue')}
        categories={points.map((point) => dateOf(point.date))}
        x={{
          values: points.map((point) => point.date * 1000),
          kind: 'time',
          locale: i18n.language,
        }}
        series={[
          {
            name: t(`connectPage.sections.${direction}`),
            colour: DIRECTION_COLOURS[direction],
            values: points.map((point) => point.speed),
          },
        ]}
        format={(value) => kmh(value) ?? ''}
        xTitle={t('connectPage.strength.colDate')}
        yTitle={t('connectPage.routes.speed')}
        trend
        picked={picked}
        onPick={setPicked}
        height={300}
      />
      {named ? (
        <p className="meta" role="status">
          <a href={`#/activity/${encodeURIComponent(named.activityId)}`}>{named.name}</a>
          {` · ${dateOf(named.date)} · ${elapsed(named.seconds * 1000)}`}
        </p>
      ) : null}
    </div>
  );
}

function Spread({
  performance,
  asked,
  choose,
}: {
  performance: Performance;
  asked: string | null;
  choose: (next: Direction) => void;
}) {
  const { t } = useTranslation();
  const [direction, directions] = directionOf(performance, asked);
  const bins = binsOf(performance, direction);
  return (
    <div className="section-view">
      <DirectionControl direction={direction} directions={directions} onChange={choose} />
      {bins.length === 0 ? (
        <EmptyState title={t('connectPage.routes.noAttempts')} />
      ) : (
        <Chart
          kind="bar"
          label={t('connectPage.sections.spreadChart')}
          empty={t('connectPage.routes.noAttempts')}
          none={t('connectPage.sections.noValue')}
          categories={bins.map((bin) => `${elapsed(bin.low * 1000)}–${elapsed(bin.high * 1000)}`)}
          series={[
            {
              name: t('connectPage.sections.laps'),
              colour: DIRECTION_COLOURS[direction],
              values: bins.map((bin) => bin.count),
            },
          ]}
          format={(value) => String(Math.round(value))}
          xTitle={t('connectPage.facts.time')}
          yTitle={t('connectPage.sections.laps')}
          height={300}
        />
      )}
    </div>
  );
}

/** How many laps' curves are drawn: the newest, each in a step of the sequential palette. */
const CURVE_LAPS = 5;

function AheadBehind({
  performance,
  asked,
  choose,
}: {
  performance: Performance;
  asked: string | null;
  choose: (next: Direction) => void;
}) {
  const { t } = useTranslation();
  const [direction, directions] = directionOf(performance, asked);
  const set = deltaCurvesOf(performance, direction);
  const shown = set?.curves.slice(-CURVE_LAPS) ?? [];
  return (
    <div className="section-view">
      <DirectionControl direction={direction} directions={directions} onChange={choose} />
      {performance.curvesPending ? (
        <p className="notice" role="status">
          {t('connectPage.sections.curvesPending')}
        </p>
      ) : null}
      {set === null || shown.length === 0 ? (
        <EmptyState title={t('connectPage.sections.noCurves')} />
      ) : (
        <Chart
          kind="line"
          label={t('connectPage.sections.deltaChart')}
          empty={t('connectPage.sections.noCurves')}
          none={t('connectPage.sections.noValue')}
          categories={set.metres.map((metres) => `${distanceValue(metres)} ${distanceUnit()}`)}
          x={{
            values: set.metres,
            kind: 'number',
            format: (metres) => `${distanceValue(metres)} ${distanceUnit()}`,
          }}
          series={shown.map((curve, at) => ({
            name: dateOf(curve.date),
            colour: `var(--colour-data-seq-${at + 1})`,
            values: curve.values,
          }))}
          format={(value) => `${value > 0 ? '+' : ''}${value.toFixed(1)} s`}
          xTitle={t('connectPage.sections.alongSection', { unit: distanceUnit() })}
          yTitle={t('connectPage.sections.behindReference')}
          height={300}
        />
      )}
    </div>
  );
}

function Laps({
  id,
  performance,
  excluded,
  batch,
  phone,
  onHover,
}: {
  id: string;
  performance: Performance;
  excluded: readonly string[];
  batch: Batch;
  phone: QueryClient;
  onHover: (activityId: string | null) => void;
}) {
  const { t } = useTranslation();
  const labels = useTableLabels();
  // The row a right click landed on, which the menu's items act on.
  const [menuRow, setMenuRow] = useState<string | null>(null);
  const rows = useMemo(() => lapRows(performance.lapRecords), [performance.lapRecords]);
  const excludedActivities = new Set(excluded);
  const send = (writes: LapWrite[], message: string) =>
    batch.run(
      writes as Write[],
      message,
      undoOf(writes) as Write[],
      t('connectPage.sections.undo')
    );
  const bulk: BulkAction<LapRow>[] = [
    {
      key: 'exclude',
      label: t('connectPage.sections.excludeLaps'),
      run: (chosen) => {
        const writes = excludeLaps(id, chosen);
        void send(writes, t('connectPage.sections.lapsExcluded', { count: writes.length }));
      },
    },
    {
      key: 'include',
      label: t('connectPage.sections.includeLaps'),
      run: (chosen) => {
        const writes = includeLaps(id, chosen);
        void send(writes, t('connectPage.sections.lapsIncluded', { count: writes.length }));
      },
    },
    {
      key: 'excludeActivities',
      label: t('connectPage.sections.excludeActivities'),
      run: (chosen) => {
        const writes = excludeActivities(id, chosen);
        void send(writes, t('connectPage.sections.activitiesExcluded', { count: writes.length }));
      },
    },
    {
      key: 'includeActivities',
      label: t('connectPage.sections.includeActivities'),
      run: (chosen) => {
        const writes = includeActivities(id, chosen);
        void send(writes, t('connectPage.sections.activitiesIncluded', { count: writes.length }));
      },
    },
  ];
  const columns: Column<LapRow>[] = [
    { key: 'date', header: t('connectPage.strength.colDate'), cell: (row) => dateOf(row.date) },
    {
      key: 'name',
      header: t('connectPage.routes.sortName'),
      clip: true,
      cell: (row) => row.activityName,
    },
    {
      key: 'direction',
      header: t('connectPage.sections.direction'),
      cell: (row) =>
        t(`connectPage.sections.${row.direction === 'reverse' ? 'reverse' : 'forward'}`),
    },
    {
      key: 'time',
      header: t('connectPage.facts.time'),
      numeric: true,
      cell: (row) => elapsed(row.time * 1000),
    },
    {
      key: 'speed',
      header: t('connectPage.routes.speed'),
      numeric: true,
      cell: (row) => kmh(row.pace),
    },
    {
      key: 'power',
      header: t('connectPage.sections.power'),
      numeric: true,
      defaultHidden: true,
      cell: (row) => (row.avgPower === null ? null : `${Math.round(row.avgPower)} W`),
    },
    {
      key: 'hr',
      header: t('connectPage.columns.hr'),
      numeric: true,
      defaultHidden: true,
      cell: (row) => (row.avgHr === null ? null : `${Math.round(row.avgHr)}`),
    },
    {
      key: 'match',
      header: t('connectPage.sections.match'),
      numeric: true,
      defaultHidden: true,
      cell: (row) => (row.match === null ? null : `${Math.round(row.match)} %`),
    },
    {
      key: 'status',
      header: t('connectPage.sections.status'),
      cell: (row) => (
        <span className="section-badges">
          {row.excluded || excludedActivities.has(row.activityId) ? (
            <Badge tone="warning">{t('connectPage.routes.excluded')}</Badge>
          ) : null}
          {row.isRecord ? <Badge>{t('connectPage.sections.statusRecord')}</Badge> : null}
          {row.outsideBand ? <Badge>{t('connectPage.sections.outsideBand')}</Badge> : null}
        </span>
      ),
    },
  ];
  if (rows.length === 0) return <EmptyState title={t('connectPage.routes.noAttempts')} />;
  const aimed = rows.find((row) => row.id === menuRow) ?? null;
  const menu = [
    {
      id: 'setReference',
      label: t('connectPage.sections.useAsReference'),
      disabled: aimed === null,
      onSelect: () => {
        if (!aimed) return;
        void undoOfEdit(phone, id).then((undo) =>
          batch.run(
            [setReferenceWrite(id, aimed.activityId)],
            t('connectPage.sections.referenceSet', { name: aimed.activityName }),
            undo,
            t('connectPage.sections.undo')
          )
        );
      },
    },
    {
      id: 'resetReference',
      label: t('connectPage.sections.resetReference'),
      onSelect: () =>
        void undoOfEdit(phone, id).then((undo) =>
          batch.run(
            [resetReferenceWrite(id)],
            t('connectPage.sections.referenceReset'),
            undo,
            t('connectPage.sections.undo')
          )
        ),
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
      <ContextMenu label={t('connectPage.sections.lapMenu')} items={menu}>
        <DataTable
          label={t('connectPage.sections.laps')}
          tableId="section-laps"
          labels={labels}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          rowProps={(row) => ({ 'data-excluded': row.excluded || undefined })}
          href={(row) => `#/activity/${encodeURIComponent(row.activityId)}`}
          selectable
          bulkActions={bulk}
          onRowHover={(row) => onHover(row?.activityId ?? null)}
        />
      </ContextMenu>
    </div>
  );
}

function History({
  id,
  shown,
  onToggle,
}: {
  id: string;
  shown: readonly number[];
  onToggle: (version: number) => void;
}) {
  const { t } = useTranslation();
  const read = useRead('section.history', { id });
  return (
    <Reading read={read}>
      {(data) => {
        const rows = historyRowsOf(data);
        return (
          <div className="section-view">
            <h3 className="panel-title">{t('connectPage.sections.ledger')}</h3>
            {rows.length === 0 ? (
              <EmptyState title={t('connectPage.sections.noHistory')} />
            ) : (
              <ol className="history">
                {rows.map((row) => (
                  <li key={row.id} data-pinned={row.pinned}>
                    <time dateTime={row.at}>{row.at.slice(0, 10)}</time>{' '}
                    <HistoryHeadline event={data.history.find((event) => event.id === row.id)} />
                    {row.activities.length ? ` · ${row.activities.join(', ')}` : ''}
                  </li>
                ))}
              </ol>
            )}
            <h3 className="panel-title">{t('connectPage.sections.geometryVersions')}</h3>
            <ul className="history">
              {data.geometryVersions.map((version) => (
                <li key={version.version} data-pinned={version.pinned}>
                  {t('connectPage.routes.version', { n: version.version })} ·{' '}
                  {version.createdAt.slice(0, 10)}
                  {version.pinned ? ` · ${t('connectPage.routes.pinned')}` : ''}{' '}
                  <Button size="sm" onClick={() => onToggle(version.version)}>
                    {shown.includes(version.version)
                      ? t('connectPage.sections.hideFromMap')
                      : t('connectPage.sections.showOnMap')}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        );
      }}
    </Reading>
  );
}

function HistoryHeadline({
  event,
}: {
  event: Methods['section.history']['result']['history'][number] | undefined;
}) {
  const { t } = useTranslation();
  if (!event) return null;
  const details = event.details;
  const copy = changeCopy(
    t as never,
    {
      kind: event.kind,
      summary: details?.summary,
      siblingCount: details?.siblings.length ?? 0,
      version: details?.version ?? event.geometryVersion ?? undefined,
      anchoredInPlace: details?.moved === false,
      rideCount: details?.around.length ?? 0,
    } as never,
    metricUnits()
  );
  return <>{copy.headline ?? t('connectPage.sections.changed')}</>;
}

function MergeCandidates({
  id,
  kept,
  candidates,
  selected,
  lit,
  phone,
  onLit,
  onSelect,
}: {
  id: string;
  /** The section the merge keeps. */
  kept: Section;
  candidates: Candidate[];
  selected: string | null;
  lit: string | null;
  phone: QueryClient;
  onLit: (id: string | null) => void;
  onSelect: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const labels = useTableLabels();
  const toast = useToast();
  const [pending, setPending] = useState<{
    candidate: Candidate;
    dropped: Methods['section.mergePreview']['result']['dropped'];
  } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  useEffect(() => {
    onLit(selected);
  }, [selected, onLit]);
  if (candidates.length === 0) return <EmptyState title={t('connectPage.sections.noCandidates')} />;
  const columns: Column<Candidate>[] = [
    {
      key: 'name',
      header: t('connectPage.routes.sortName'),
      clip: true,
      cell: (row) => row.name ?? t(NO_NAME),
    },
    {
      key: 'overlap',
      header: t('connectPage.sections.overlap'),
      numeric: true,
      cell: (row) => `${Math.round(row.overlapPct)} %`,
    },
    {
      key: 'distance',
      header: t('connectPage.routes.sortDistance'),
      numeric: true,
      cell: (row) => km(row.distanceMeters),
    },
    {
      key: 'passes',
      header: t('connectPage.routes.passes'),
      numeric: true,
      cell: (row) => String(row.visitCount),
    },
    {
      key: 'merge',
      header: null,
      label: t('connectPage.sections.merge'),
      cell: (row) => (
        <Button
          size="sm"
          onClick={(event) => {
            event.stopPropagation();
            void (
              phone.fetch('section.mergePreview', {
                primaryId: id,
                secondaryId: row.sectionId,
              }) as Promise<Methods['section.mergePreview']['result']>
            ).then(
              (preview) => setPending({ candidate: row, dropped: preview.dropped }),
              (error: unknown) =>
                setRefusal(
                  error instanceof Error ? error.message : t('connectPage.routes.editFailed')
                )
            );
          }}
        >
          {t('connectPage.sections.merge')}
        </Button>
      ),
    },
  ];
  return (
    <div className="section-view">
      {refusal ? (
        <p className="notice" role="alert">
          {refusal}
        </p>
      ) : null}
      <DataTable
        label={t('connectPage.sections.mergeCandidatesLabel')}
        tableId="section-candidates"
        labels={labels}
        columns={columns}
        rows={candidates}
        rowKey={(row) => row.sectionId}
        selectedKey={selected ?? lit}
        onRowClick={(row) => onSelect(row.sectionId)}
        onRowHover={(row) => onLit(row?.sectionId ?? selected)}
        href={(row) => `#/section/${encodeURIComponent(row.sectionId)}`}
      />
      <Dialog
        open={pending !== null}
        title={t('connectPage.sections.mergeTitle', {
          name: pending?.candidate.name ?? t(NO_NAME),
        })}
        description={t('connectPage.sections.mergeBody', { count: pending?.dropped.length ?? 0 })}
        onClose={() => setPending(null)}
        actions={
          <>
            <Button onClick={() => setPending(null)}>{t('connectPage.sections.cancel')}</Button>
            <Button
              variant="destructive"
              onClick={() => {
                const candidate = pending?.candidate;
                setPending(null);
                if (!candidate) return;
                void phone
                  .write('section.merge', { primaryId: id, secondaryId: candidate.sectionId })
                  .then(
                    (outcome) => {
                      toast(
                        t('connectPage.sections.mergeDone', {
                          name: candidate.name ?? t(NO_NAME),
                        }),
                        {
                          label: t('connectPage.sections.undo'),
                          run: () =>
                            void phone
                              .write('section.restore', { id: candidate.sectionId })
                              .catch(() => undefined),
                        }
                      );
                      go({ screen: 'section', id: outcome.result.sectionId, query: [] });
                    },
                    (error: unknown) =>
                      setRefusal(
                        error instanceof Error ? error.message : t('connectPage.routes.editFailed')
                      )
                  );
              }}
            >
              {t('connectPage.sections.merge')}
            </Button>
          </>
        }
      >
        <p className="meta">
          {t('connectPage.sections.mergeKept', {
            name: kept.name ?? t(NO_NAME),
            length: km(kept.distanceMeters) ?? '',
            count: kept.visitCount,
          })}
        </p>
        <ul className="merge-dropped">
          {(pending?.dropped ?? []).slice(0, 8).map((ride) => (
            <li key={ride.activityId}>
              {dateOf(ride.startDate)} · {ride.name}
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}

/** A section no longer in the list: when and how it left, and the way back when the engine keeps one. */
function Retired({ detail, id, batch }: { detail: Detail; id: string; batch: Batch }) {
  const { t } = useTranslation();
  const retirement = detail.retirement;
  if (!retirement) return <EmptyState title={t('connectPage.routes.sectionFailed')} />;
  return (
    <Card>
      <h2 className="panel-title">{t('connectPage.sections.retiredHeading')}</h2>
      <p>
        {t('connectPage.sections.retiredBody', {
          date: retirement.at.slice(0, 10),
        })}
        {retirement.into ? (
          <>
            {' '}
            <a href={`#/section/${encodeURIComponent(retirement.into)}`}>
              {retirement.intoName ?? t(NO_NAME)}
            </a>
          </>
        ) : null}
      </p>
      <Button
        onClick={() =>
          void batch.run(
            [{ method: 'section.restore', params: { id } }],
            t('connectPage.sections.restoredShort'),
            [],
            ''
          )
        }
      >
        {t('connectPage.sections.restore')}
      </Button>
    </Card>
  );
}
