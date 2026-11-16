// The sections page: the engine's list as a table beside the map of every
// section, a panel for the selected one, and the retired sections as a view of
// their own. The address holds the sort, search, filters, selection and view;
// the engine orders, filters and counts, and this draws its answer.

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { km } from '../format';
import { RoutesMap } from '../map/RoutesMap';
import { go, type Route } from '../router';
import {
  listRows,
  queryOf,
  retiredRows,
  routeOf,
  viewOf,
  type ListRow,
  type RetiredRow,
  type SectionsView,
} from '../sectionsList';
import { CHIPS, SECTION_SORTS, opening, toggled, type Chip } from '../routesList';
import { Reading } from '../shell/StatePanes';
import { useTableLabels } from '../tableLabels';
import {
  Button,
  Card,
  Chip as ChipToggle,
  ChipGroup,
  ConfirmDialog,
  DataTable,
  EmptyState,
  SearchField,
  SegmentedControl,
  Select,
  ToastProvider,
  type Column,
} from '../ui';
import { useBatch } from '../useBatch';
import { useQueries, useRead } from '../useRead';
import { StatusBadges, Trend } from './SectionParts';

/** How long typing pauses before the search is asked of the phone. */
const SEARCH_PAUSE_MS = 250;

const CHIP_KEYS: Record<
  Chip,
  | 'connectPage.routes.chipCustom'
  | 'connectPage.routes.chipRemoved'
  | 'connectPage.routes.chipAccepted'
> = {
  custom: 'connectPage.routes.chipCustom',
  removed: 'connectPage.routes.chipRemoved',
  accepted: 'connectPage.routes.chipAccepted',
};

const SORT_KEYS = {
  visits: 'connectPage.routes.sortVisits',
  signature: 'connectPage.routes.sortRelevance',
  distance: 'connectPage.routes.sortDistance',
  name: 'connectPage.routes.sortName',
} as const;

const NO_NAME = 'connectPage.routes.unnamedSection';

export function SectionsPage({ route }: { route: Route }) {
  const { t } = useTranslation();
  return (
    <ToastProvider dismissLabel={t('connectPage.sections.dismiss')}>
      <Sections view={viewOf(route)} />
    </ToastProvider>
  );
}

function Sections({ view }: { view: SectionsView }) {
  const { t } = useTranslation();
  const phone = useQueries();
  const change = (next: Partial<SectionsView>) => go(routeOf({ ...view, ...next }));
  const list = useRead('routes.screen', queryOf(view) as never);
  const retired = useRead('sections.retired', view.retired ? ({} as never) : null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const batch = useBatch(phone, t('connectPage.routes.editFailed'));
  const toReview = list.data?.unacceptedAutoCount ?? 0;

  return (
    <section id="sections-page" data-view={view.retired ? 'retired' : 'sections'}>
      <div id="sections-list" className="pane">
        <Card label={t('connectPage.routes.sections')}>
          <Toolbar
            view={view}
            onChange={change}
            toReview={toReview}
            onAcceptAll={() => setConfirming(true)}
          />
          {batch.refusal ? (
            <p className="notice" role="alert">
              {batch.refusal}
            </p>
          ) : null}
          {view.retired ? (
            <Reading read={retired}>
              {(data) => (
                <RetiredTable
                  rows={retiredRows(data)}
                  onRestore={(row) =>
                    void batch.run(
                      [{ method: 'section.restore', params: { id: row.id } }],
                      t('connectPage.sections.restored', { name: row.name ?? t(NO_NAME) }),
                      [],
                      ''
                    )
                  }
                />
              )}
            </Reading>
          ) : (
            <Reading read={list}>
              {(data) => (
                <SectionTable
                  view={view}
                  rows={listRows(data)}
                  total={data.filteredSectionCount}
                  more={data.hasMoreSections}
                  onChange={change}
                  onHover={setHovered}
                />
              )}
            </Reading>
          )}
        </Card>
      </div>
      {view.retired ? null : (
        <div id="sections-map" className="pane" aria-label={t('connectPage.activity.map')}>
          <RoutesMap
            queries={phone}
            target={{ kind: 'sections' }}
            hoveredRow={hovered ?? view.selected}
            onHoverRow={setHovered}
            askedTracks={[]}
            selected={[]}
            onOpen={(id) => change({ selected: id })}
            onPickPass={() => undefined}
          />
          {view.selected ? (
            <Selection
              row={listRows(list.data ?? null).find((row) => row.id === view.selected) ?? null}
              id={view.selected}
              onClose={() => change({ selected: null })}
            />
          ) : null}
        </div>
      )}
      <ConfirmDialog
        open={confirming}
        title={t('connectPage.sections.acceptAllTitle')}
        description={t('connectPage.sections.acceptAllBody', { count: toReview })}
        confirmLabel={t('connectPage.sections.acceptAll')}
        cancelLabel={t('connectPage.sections.cancel')}
        variant="primary"
        onConfirm={() =>
          void batch.run(
            [{ method: 'section.acceptAll', params: {} }],
            t('connectPage.sections.acceptedAll', { count: toReview }),
            ([accepted]) => {
              const { ids } = accepted as { ids: string[] };
              return ids.length === 0 ? [] : [{ method: 'section.unaccept', params: { ids } }];
            },
            t('connectPage.sections.undo')
          )
        }
        onClose={() => setConfirming(false)}
      />
    </section>
  );
}

/** The filters, sort, search and views of the list, and the one bulk action. */
function Toolbar({
  view,
  onChange,
  toReview,
  onAcceptAll,
}: {
  view: SectionsView;
  onChange: (next: Partial<SectionsView>) => void;
  toReview: number;
  onAcceptAll: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(view.search);
  useEffect(() => {
    if (text === view.search) return undefined;
    const typing = setTimeout(() => onChange({ search: text, selected: null }), SEARCH_PAUSE_MS);
    return () => clearTimeout(typing);
    // `onChange` is a new function each render; the text and the address say what to write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.search, text]);
  return (
    <div className="filter-bar">
      <SegmentedControl
        label={t('connectPage.sections.view')}
        value={view.retired ? 'retired' : 'sections'}
        options={[
          { value: 'sections', label: t('connectPage.routes.sections') },
          { value: 'retired', label: t('connectPage.sections.retired') },
        ]}
        onChange={(value) => onChange({ retired: value === 'retired', selected: null })}
      />
      {view.retired ? null : (
        <>
          <SearchField
            label={t('connectPage.routes.searchSections')}
            clearLabel={t('connectPage.sections.clearSearch')}
            placeholder={t('connectPage.routes.searchHint')}
            value={text}
            onChange={setText}
          />
          <Select
            label={t('connectPage.routes.sort')}
            value={view.sort}
            options={SECTION_SORTS.filter((sort) => sort !== 'nearby').map((sort) => ({
              value: sort,
              label: t(SORT_KEYS[sort as keyof typeof SORT_KEYS]),
            }))}
            onChange={(sort) => onChange({ sort, selected: null })}
          />
          <ChipGroup label={t('connectPage.routes.show')}>
            {CHIPS.map((chip) => (
              <ChipToggle
                key={chip}
                selected={view.chips.includes(chip)}
                onToggle={() =>
                  onChange({
                    chips: toggled({ ...OPENING_STATE, chips: view.chips }, chip).chips,
                    selected: null,
                  })
                }
              >
                {t(CHIP_KEYS[chip])}
              </ChipToggle>
            ))}
          </ChipGroup>
          <Button variant="primary" disabled={toReview === 0} onClick={onAcceptAll}>
            {t('connectPage.sections.acceptAllCount', { count: toReview })}
          </Button>
        </>
      )}
    </div>
  );
}

const OPENING_STATE = { ...opening('sections') };

/** The sections the engine listed, in its order: a click selects, the name opens the page. */
function SectionTable({
  view,
  rows,
  total,
  more,
  onChange,
  onHover,
}: {
  view: SectionsView;
  rows: ListRow[];
  total: number;
  more: boolean;
  onChange: (next: Partial<SectionsView>) => void;
  onHover: (id: string | null) => void;
}) {
  const { t } = useTranslation();
  const labels = useTableLabels();
  const columns: Column<ListRow>[] = [
    {
      key: 'name',
      header: t('connectPage.routes.sortName'),
      sortable: true,
      clip: true,
      cell: (row) => row.name ?? t(NO_NAME),
    },
    {
      key: 'distance',
      header: t('connectPage.routes.sortDistance'),
      numeric: true,
      sortable: true,
      cell: (row) => km(row.distance),
    },
    {
      key: 'grade',
      header: t('connectPage.sections.grade'),
      numeric: true,
      cell: (row) => (row.grade === null ? null : `${row.grade.toFixed(1)} %`),
    },
    {
      key: 'visits',
      header: t('connectPage.routes.passes'),
      numeric: true,
      sortable: true,
      cell: (row) => String(row.passes),
    },
    {
      key: 'trend',
      header: t('connectPage.sections.trend'),
      cell: (row) => <Trend value={row.trend} />,
    },
    {
      key: 'status',
      header: t('connectPage.sections.status'),
      cell: (row) => <StatusBadges status={row.status} />,
    },
  ];
  if (rows.length === 0) return <EmptyState title={t('connectPage.sections.none')} />;
  return (
    <>
      <DataTable
        label={t('connectPage.routes.sections')}
        tableId="sections"
        labels={labels}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        href={(row) => `#/section/${encodeURIComponent(row.id)}`}
        sort={{ key: view.sort, direction: view.sort === 'name' ? 'asc' : 'desc' }}
        onSort={(sort) => onChange({ sort, selected: null })}
        selectedKey={view.selected}
        onRowClick={(row) => onChange({ selected: row.id })}
        onOpen={(row) => go({ screen: 'section', id: row.id, query: [] })}
        onRowHover={(row) => onHover(row?.id ?? null)}
      />
      <p className="meta">{t('connectPage.routes.shown', { count: total })}</p>
      {more ? <p className="meta">{t('connectPage.routes.more')}</p> : null}
    </>
  );
}

/** The sections that left the list and the sections that took their ground. */
function RetiredTable({
  rows,
  onRestore,
}: {
  rows: RetiredRow[];
  onRestore: (row: RetiredRow) => void;
}) {
  const { t } = useTranslation();
  const labels = useTableLabels();
  if (rows.length === 0) return <EmptyState title={t('connectPage.sections.noneRetired')} />;
  const columns: Column<RetiredRow>[] = [
    {
      key: 'name',
      header: t('connectPage.routes.sortName'),
      clip: true,
      cell: (row) => row.name ?? t(NO_NAME),
    },
    {
      key: 'kind',
      header: t('connectPage.sections.how'),
      cell: (row) =>
        t(`sectionHistory.kind_${row.kind}` as never, {
          defaultValue: t('connectPage.sections.typeOther'),
        }),
    },
    { key: 'date', header: t('connectPage.sections.left'), cell: (row) => row.date },
    {
      key: 'distance',
      header: t('connectPage.routes.sortDistance'),
      numeric: true,
      cell: (row) => km(row.distance),
    },
    {
      key: 'passes',
      header: t('connectPage.routes.passes'),
      numeric: true,
      cell: (row) => (row.passes === null ? null : String(row.passes)),
    },
    {
      key: 'took',
      header: t('connectPage.sections.tookGround'),
      cell: (row) =>
        row.tookGround.map((taken, at) => (
          <span key={taken.id}>
            {at > 0 ? ', ' : ''}
            <a href={`#/section/${encodeURIComponent(taken.id)}`}>{taken.name ?? t(NO_NAME)}</a>
            {taken.overlap === null ? '' : ` ${Math.round(taken.overlap * 100)} %`}
          </span>
        )),
    },
    {
      key: 'restore',
      header: null,
      label: t('connectPage.sections.restore'),
      cell: (row) =>
        row.restorable ? (
          <Button size="sm" onClick={() => onRestore(row)}>
            {t('connectPage.sections.restore')}
          </Button>
        ) : null,
    },
  ];
  return (
    <DataTable
      label={t('connectPage.sections.retired')}
      tableId="sections-retired"
      labels={labels}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
    />
  );
}

/** The selected section's facts from the list, with the way to its page. */
function Selection({ row, id, onClose }: { row: ListRow | null; id: string; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <aside id="sections-selection" className="pane" aria-label={t('connectPage.sections.selected')}>
      <Card>
        <h3 className="panel-title">{row ? (row.name ?? t(NO_NAME)) : id}</h3>
        {row ? (
          <>
            <p className="badge-row">
              <StatusBadges status={row.status} />
            </p>
            <dl className="facts">
              <dt>{t('connectPage.routes.sortDistance')}</dt>
              <dd>{km(row.distance)}</dd>
              {row.grade === null ? null : (
                <>
                  <dt>{t('connectPage.sections.grade')}</dt>
                  <dd>{row.grade.toFixed(1)} %</dd>
                </>
              )}
              <dt>{t('connectPage.routes.passes')}</dt>
              <dd>{row.passes}</dd>
              {row.trend ? (
                <>
                  <dt>{t('connectPage.sections.trend')}</dt>
                  <dd>
                    <Trend value={row.trend} />
                  </dd>
                </>
              ) : null}
            </dl>
          </>
        ) : null}
        <p className="actions">
          <a className="section-open" href={`#/section/${encodeURIComponent(id)}`}>
            {t('connectPage.sections.open')}
          </a>
          <Button onClick={onClose}>{t('connectPage.sections.close')}</Button>
        </p>
      </Card>
    </aside>
  );
}
