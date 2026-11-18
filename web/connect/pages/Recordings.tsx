// The recordings on this phone: one table, newest first, sorted by the column
// the hash names. Uploads and deletes stay on the phone, so the table only reads.

import { useTranslation } from 'react-i18next';

import { clock, km, localDateTime } from '../format';
import { go, replaceRoute, write, type Route } from '../router';
import {
  nextOrder,
  orderRows,
  readTableOrder,
  sortProp,
  writeTableOrder,
  type OrderValue,
} from '../tableOrder';
import type { Methods } from '../schema';
import { useSportName, useUploadStatusName } from '../names';
import { knownStatus, uploadTone } from '../recordingStatus';
import { Reading } from '../shell/StatePanes';
import { Badge, DataTable, EmptyState, type Column } from '../ui';
import { filterCount, matchesFilter, readFilterText, withFilterText } from '../ui/filterText';
import { useFilterDraft } from '../useFilterDraft';
import { useTableLabels } from '../tableLabels';
import { useRead } from '../useRead';

type Recording = Methods['recordings.list']['result']['recordings'][number];

const COLUMNS = ['name', 'started', 'sport', 'distance', 'duration', 'upload', 'error'] as const;
type RecordingColumn = (typeof COLUMNS)[number];

/** Newest first, which is the order the phone answers in. */
const DEFAULT = { column: 'started', descending: true } as const;

/** The columns whose first sort is largest first. */
const DESCENDING_FIRST: readonly RecordingColumn[] = ['started', 'distance', 'duration'];

function RecordingsTable({ rows, route }: { rows: Recording[]; route: Route }) {
  const { t } = useTranslation();
  const labels = useTableLabels();
  const sportName = useSportName();
  const statusName = useUploadStatusName();
  const order = readTableOrder(route, 'recordings', COLUMNS, DEFAULT);
  const text = readFilterText(route);
  const [draft, setDraft] = useFilterDraft(text, (next) =>
    replaceRoute(withFilterText(route, next))
  );
  const shown = rows.filter((row) =>
    matchesFilter(text, [
      row.name,
      sportName(row.activityType),
      statusName(row.uploadStatus),
      row.lastError,
    ])
  );
  const values: Record<RecordingColumn, (row: Recording) => OrderValue> = {
    name: (row) => row.name,
    started: (row) => row.startTime,
    sport: (row) => row.activityType,
    distance: (row) => row.distanceMeters,
    duration: (row) => row.durationSeconds,
    upload: (row) => statusName(row.uploadStatus),
    error: (row) => row.lastError,
  };
  const columns: Column<Recording>[] = [
    {
      key: 'name',
      header: t('connectPage.columns.name'),
      sortable: true,
      cell: (row) => row.name,
    },
    {
      key: 'started',
      header: t('connectPage.recordings.started'),
      sortable: true,
      cell: (row) => localDateTime(row.startTime),
    },
    {
      key: 'sport',
      header: t('connectPage.columns.sport'),
      sortable: true,
      cell: (row) => sportName(row.activityType),
    },
    {
      key: 'distance',
      header: t('connectPage.columns.distance'),
      sortable: true,
      numeric: true,
      cell: (row) => km(row.distanceMeters),
    },
    {
      key: 'duration',
      header: t('connectPage.recordings.duration'),
      sortable: true,
      numeric: true,
      cell: (row) => clock(row.durationSeconds),
    },
    {
      key: 'upload',
      header: t('connectPage.recordings.upload'),
      sortable: true,
      cell: (row) => {
        const status = knownStatus(row.uploadStatus);
        return <Badge tone={uploadTone(status)}>{statusName(status)}</Badge>;
      },
    },
    {
      key: 'error',
      header: t('connectPage.recordings.lastError'),
      sortable: true,
      clip: true,
      cell: (row) => row.lastError ?? '',
    },
  ];
  return (
    <DataTable
      label={t('connectPage.recordings.heading')}
      tableId="recordings"
      labels={labels}
      filter={{
        id: 'search',
        label: t('connectPage.filter.recordings'),
        clearLabel: t('connectPage.filter.clear'),
        value: draft,
        onChange: setDraft,
        count: filterCount(shown.length, rows.length),
        countText: (count) => t('connectPage.filter.count', count),
      }}
      columns={columns}
      rows={orderRows(shown, order, (row, column) => values[column](row))}
      rowKey={(row) => row.id}
      rowAction="open"
      href={(row) => write({ screen: 'recording', id: row.id, query: [] })}
      sort={sortProp(order)}
      onSort={(key) =>
        go(
          writeTableOrder(
            route,
            'recordings',
            nextOrder(
              order,
              key as RecordingColumn,
              DESCENDING_FIRST.includes(key as RecordingColumn)
            ),
            DEFAULT
          )
        )
      }
    />
  );
}

export function RecordingsPage({ route }: { route: Route }) {
  const { t } = useTranslation();
  const read = useRead('recordings.list', {});
  return (
    <section id="recordings">
      <p className="page-intro">{t('connectPage.recordings.intro')}</p>
      <Reading read={read}>
        {(answer) =>
          answer.recordings.length === 0 ? (
            <EmptyState
              title={t('recording.library.empty')}
              detail={t('recording.library.emptyHint')}
            />
          ) : (
            <div id="recordings-list">
              <RecordingsTable rows={answer.recordings} route={route} />
            </div>
          )
        }
      </Reading>
    </section>
  );
}
