// The export pane: save the whole library from the phone as one ZIP file. The athlete may name a
// first date and whether each ride's original file goes in; the pane shows the phone writing the
// archive as rides done, then the bytes saved against its length. A link that dropped mid-pull
// reads as resumed, because the session carries on from the bytes already saved.

import { dayStartEpochSeconds } from '@/shared/time/startDate';
import type { ParseKeys } from 'i18next';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { ExportOptions } from './exportArchive';
import type { LibraryExport } from './session';
import { Button, Switch, TextField } from './ui';

const PHASE_KEY = {
  building: 'connectPage.export.building',
  reading: 'connectPage.export.reading',
  waiting: 'connectPage.export.waiting',
  finished: 'connectPage.export.finished',
  failed: 'connectPage.export.failed',
} as const satisfies Record<LibraryExport['phase'], ParseKeys>;

const RUNNING: readonly LibraryExport['phase'][] = ['building', 'reading', 'waiting'];

const megabytes = (bytes: number) => (bytes / 1_000_000).toFixed(1);

/** Midnight of a `YYYY-MM-DD` date in the space activity dates are stored in, or null for none. */
export function sinceOf(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const at = dayStartEpochSeconds(date);
  return Number.isNaN(at) ? null : at;
}

export function ExportPane({
  libraryExport,
  exportLibrary,
}: {
  libraryExport: LibraryExport | null;
  exportLibrary: (options: ExportOptions) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [since, setSince] = useState('');
  const [originals, setOriginals] = useState(true);
  const running = libraryExport !== null && RUNNING.includes(libraryExport.phase);
  return (
    <section id="export">
      <h2>{t('connectPage.export.title')}</h2>
      <p className="note">{t('connectPage.export.note')}</p>
      <TextField
        id="export-since"
        type="date"
        label={t('connectPage.export.since')}
        value={since}
        onChange={setSince}
      />
      <Switch
        id="export-originals"
        label={t('connectPage.export.originals')}
        checked={originals}
        onChange={setOriginals}
      />
      <Button
        id="export-start"
        variant="secondary"
        disabled={running}
        onClick={() => void exportLibrary({ since: sinceOf(since), originals })}
      >
        {t('connectPage.export.start')}
      </Button>
      {libraryExport ? (
        <div id="export-pull">
          <p id="export-status" role="status">
            {t(PHASE_KEY[libraryExport.phase], {
              done:
                libraryExport.phase === 'building'
                  ? libraryExport.ridesDone
                  : megabytes(libraryExport.written),
              rides: libraryExport.rides,
              size: megabytes(libraryExport.bytes),
            })}
          </p>
          {libraryExport.phase === 'reading' || libraryExport.phase === 'waiting' ? (
            <progress
              id="export-progress"
              value={libraryExport.written}
              max={libraryExport.bytes}
            />
          ) : null}
          {libraryExport.phase === 'failed' && libraryExport.error ? (
            <p id="export-error" className="notice" role="alert">
              {libraryExport.error}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
