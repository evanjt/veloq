// One recording: its head, its figures, where its upload stands and its notes.
// The track is drawn by the map, and nothing here uploads or deletes.

import type { ParseKeys } from 'i18next';
import { useTranslation } from 'react-i18next';

import { clock, km, localDateTime } from '../format';
import { useSportName, useUploadStatusName } from '../names';
import { knownStatus, uploadTone, type UploadStatus } from '../recordingStatus';
import type { Methods } from '../schema';
import type { Route } from '../router';
import { Reading } from '../shell/StatePanes';
import { usePageName } from '../shell/pageName';
import { Badge, DetailHeader, EmptyState, Skeleton } from '../ui';
import { useRead } from '../useRead';

type Recording = NonNullable<Methods['recordings.get']['result']['recording']>;

/** One recording's figures, as the stats grid the activity page uses, each shown when the phone has it. */
function Figures({ recording }: { recording: Recording }) {
  const { t } = useTranslation();
  const figures: [label: string, value: string | null][] = [
    [t('connectPage.recordings.duration'), clock(recording.durationSeconds)],
    [t('connectPage.facts.distance'), km(recording.distanceMeters)],
    [
      t('connectPage.facts.climbing'),
      recording.elevationGain == null ? null : `${Math.round(recording.elevationGain)} m`,
    ],
    [
      t('connectPage.facts.averageHr'),
      recording.avgHeartrate == null ? null : `${Math.round(recording.avgHeartrate)} bpm`,
    ],
  ];
  return (
    <dl id="recording-stats">
      {figures
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <div className="recording-stat" key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
    </dl>
  );
}

/** Where the upload stands and what the phone does next. Nothing here changes it. */
function UploadPanel({ recording }: { recording: Recording }) {
  const { t } = useTranslation();
  const statusName = useUploadStatusName();
  const status: UploadStatus = knownStatus(recording.uploadStatus);
  return (
    <section id="recording-status" className="recording-status">
      <h3 className="panel-title">{t('connectPage.recordings.upload')}</h3>
      <p>
        <Badge tone={uploadTone(status)}>{statusName(status)}</Badge>
      </p>
      <p>{t(`connectPage.recordings.next.${status}` as ParseKeys)}</p>
      {recording.lastError ? (
        <p className="recording-error">
          {t('connectPage.recordings.lastError')}: {recording.lastError}
        </p>
      ) : null}
      <p className="recording-phone">{t('connectPage.recordings.phoneActions')}</p>
    </section>
  );
}

function RecordingPane({ answer }: { answer: Methods['recordings.get']['result'] }) {
  const { t } = useTranslation();
  const sportName = useSportName();
  const recording = answer?.recording;
  if (!recording) {
    return (
      <section id="recording">
        {answer ? (
          <EmptyState title={t('connectPage.recordings.notFound')} />
        ) : (
          <Skeleton label={t('connectPage.routes.reading')} />
        )}
      </section>
    );
  }
  return (
    <section id="recording">
      <DetailHeader
        facts={[localDateTime(recording.startTime), sportName(recording.activityType)]}
        provenance={t('connectPage.recordings.provenance')}
      />
      <div className="recording-body">
        <Figures recording={recording} />
        <UploadPanel recording={recording} />
      </div>
      {recording.notes ? (
        <section id="recording-notes">
          <h3 className="panel-title">{t('connectPage.recordings.notes')}</h3>
          <p>{recording.notes}</p>
        </section>
      ) : null}
    </section>
  );
}

export function RecordingPage({ route }: { route: Route }) {
  const read = useRead('recordings.get', route.id === null ? null : { id: route.id });
  usePageName(read.data?.recording?.name);
  return <Reading read={read}>{(answer) => <RecordingPane answer={answer} />}</Reading>;
}
