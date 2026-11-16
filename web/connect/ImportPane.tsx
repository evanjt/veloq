// The import pane: choose a `.zip`, `.fit` or `.fit.gz` file, watch it go to the phone as bytes
// sent against its size, and read what the phone's import job made of it. A link that dropped
// mid-send reads as resumed, because the session carries on from the phone's byte count.

import type { ParseKeys } from 'i18next';
import { useTranslation } from 'react-i18next';

import type { Upload } from './session';
import { FilePicker } from './ui';

const PHASE_KEY = {
  hashing: 'connectPage.import.hashing',
  sending: 'connectPage.import.sending',
  waiting: 'connectPage.import.waiting',
  importing: 'connectPage.import.importing',
  finished: 'connectPage.import.finished',
  failed: 'connectPage.import.failed',
} as const satisfies Record<Upload['phase'], ParseKeys>;

const TRANSFER_PHASES: readonly Upload['phase'][] = ['hashing', 'sending', 'waiting'];

const ACCEPTED_FILES = ['.zip', '.fit', '.fit.gz'].join(',');

const megabytes = (bytes: number) => (bytes / 1_000_000).toFixed(1);

export function ImportPane({
  upload,
  notice,
  importArchive,
}: {
  upload: Upload | null;
  notice: ParseKeys | null;
  importArchive: (file: File) => Promise<void>;
}) {
  const { t } = useTranslation();
  const job = upload?.job ?? null;
  return (
    <section id="import">
      <h2>{t('connectPage.import.title')}</h2>
      <p className="note">{t('connectPage.import.note')}</p>
      <FilePicker
        id="import-file"
        label={t('connectPage.import.choose')}
        accept={ACCEPTED_FILES}
        onPick={(file) => void importArchive(file)}
      />
      {notice ? (
        <p id="import-notice" className="notice" role="status">
          {t(notice)}
        </p>
      ) : null}
      {upload ? (
        <div id="import-upload">
          <p id="import-name">{upload.name}</p>
          <p id="import-status" role="status">
            {t(PHASE_KEY[upload.phase], {
              done: megabytes(upload.done),
              size: megabytes(upload.size),
            })}
          </p>
          {TRANSFER_PHASES.includes(upload.phase) ? (
            <progress id="import-progress" value={upload.done} max={upload.size} />
          ) : null}
          {job ? (
            <dl id="import-counts">
              <dt>{t('connectPage.import.stored')}</dt>
              <dd>{job.stored}</dd>
              <dt>{t('connectPage.import.alreadyStored')}</dt>
              <dd>{job.alreadyStored}</dd>
              <dt>{t('connectPage.import.failedCount')}</dt>
              <dd>{job.failed}</dd>
            </dl>
          ) : null}
          {job && job.failures.length > 0 ? (
            <ul id="import-failures">
              {job.failures.map((failure) => (
                <li key={`${failure.name}:${failure.reason}`}>
                  {failure.name}: {failure.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
