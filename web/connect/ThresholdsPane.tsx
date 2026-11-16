// The thresholds pane: each sport's figures with where the phone got each, an
// editable value per cell, and each sport's zone edges.
// An edit is one `settings.setThreshold`; a blank cell, or the button beside a
// figure the athlete set, hands it back to the activity files. The phone
// refuses a value that is not a positive number, and the pane says so before
// asking.

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ParseKeys } from 'i18next';

import { ReadNotice } from './shell/StatePanes';
import {
  SOURCE_KEYS,
  THRESHOLD_FIELDS,
  thresholdUndo,
  thresholdWrite,
  type Figure,
} from './thresholdSettings';
import { Button, TextField } from './ui';
import { useRead } from './useRead';
import { useSavedWrite } from './useSavedWrite';

const SPORT_KEYS: Readonly<Record<string, ParseKeys>> = {
  Ride: 'connectPage.settings.thresholds.sports.Ride',
  Run: 'connectPage.settings.thresholds.sports.Run',
};

/** The value intervals.icu puts last in a list of power zones for a top zone with no upper edge. */
const POWER_ZONE_OPEN_TOP_PERCENT = 999;

const cellId = (sport: string, field: string) => `threshold-${sport}-${field}`;

export function ThresholdsPane() {
  const { t } = useTranslation();
  const read = useRead('settings.thresholds', {} as never);
  const { save, refusal, clearRefusal } = useSavedWrite(['settings.thresholds']);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [invalid, setInvalid] = useState<ParseKeys | null>(null);
  const held = read.data;

  const commit = useCallback(
    async (sport: string, figure: Figure, raw: string) => {
      const id = cellId(sport, figure.field);
      const write = thresholdWrite(figure, sport, raw);
      if (!write.ok) {
        clearRefusal();
        setInvalid(write.error);
        if (!write.error) setDrafts(({ [id]: _unchanged, ...rest }) => rest);
        return;
      }
      setInvalid(null);
      const taken = await save(
        { method: write.method, params: write.params },
        { previous: thresholdUndo(sport, figure) }
      );
      if (taken) setDrafts(({ [id]: _taken, ...rest }) => rest);
    },
    [save, clearRefusal]
  );

  if (read.error && !held) return <ReadNotice error={read.error} onRetry={read.retry} />;
  if (!held) return <p id="thresholds-loading">{t('connectPage.settings.notSet')}</p>;

  return (
    <div id="thresholds-pane">
      <p className="note">{t('connectPage.settings.thresholds.note')}</p>
      {held.sports.map((entry) => (
        <table key={entry.sport} className="settings-table" id={`settings-thresholds-${entry.sport}`}>
          <caption>{t(SPORT_KEYS[entry.sport] ?? 'connectPage.settings.thresholds.otherSport')}</caption>
          <thead>
            <tr>
              <th scope="col">{t('connectPage.settings.columns.setting')}</th>
              <th scope="col">{t('connectPage.settings.columns.value')}</th>
              <th scope="col">{t('connectPage.settings.columns.source')}</th>
            </tr>
          </thead>
          <tbody>
            {THRESHOLD_FIELDS.map(({ field, label }) => {
              const figure = entry.figures.find((candidate) => candidate.field === field);
              if (!figure) return null;
              const id = cellId(entry.sport, field);
              const draft = drafts[id] ?? (figure.value === null ? '' : String(figure.value));
              const submit = () => void commit(entry.sport, figure, draft);
              return (
                <tr key={field}>
                  <th scope="row">{t(label)}</th>
                  <td>
                    <TextField
                      id={id}
                      label={t(label)}
                      hideLabel
                      inputMode="decimal"
                      value={draft}
                      onChange={(next) => setDrafts((current) => ({ ...current, [id]: next }))}
                      onBlur={submit}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') submit();
                      }}
                    />
                  </td>
                  <td className="settings-source">
                    {figure.source ? t(SOURCE_KEYS[figure.source]) : t('connectPage.settings.notSet')}
                    {figure.source === 'athlete' ? (
                      <Button
                        id={`threshold-clear-${entry.sport}-${field}`}
                        size="sm"
                        variant="ghost"
                        onClick={() => void commit(entry.sport, figure, '')}
                      >
                        {t('connectPage.settings.thresholds.useFiles')}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ))}
      {invalid || refusal ? (
        <p id="threshold-notice" role="alert">
          {invalid ? t(invalid) : refusal}
        </p>
      ) : null}
      {held.sports.map((entry) => {
        const sport = t(SPORT_KEYS[entry.sport] ?? 'connectPage.settings.thresholds.otherSport');
        const fromSettings = entry.hrZones.source === 'sportSettings';
        return (
          <div key={entry.sport}>
            <table id={`settings-zones-${entry.sport}`} className="settings-table">
              <caption>{t('connectPage.settings.thresholds.zones.title', { sport })}</caption>
              <thead>
                <tr>
                  <th scope="col">{t('connectPage.settings.thresholds.zones.zone')}</th>
                  <th scope="col">{t('connectPage.settings.thresholds.zones.upper')}</th>
                  <th scope="col">{t('connectPage.settings.columns.source')}</th>
                </tr>
              </thead>
              <tbody>
                {entry.hrZones.upper.map((upper, at) => (
                  <tr key={at} data-zone>
                    <th scope="row">{t('connectPage.settings.thresholds.zones.name', { n: at + 1 })}</th>
                    <td>
                      {fromSettings
                        ? t('connectPage.settings.thresholds.zones.bpm', { value: upper })
                        : t('connectPage.settings.thresholds.zones.percentOfMaxHr', { value: upper })}
                    </td>
                    <td className="settings-source">
                      {t(
                        fromSettings
                          ? 'connectPage.settings.thresholds.source.sportSettings'
                          : 'connectPage.settings.thresholds.source.default'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {entry.powerZones.length > 0 ? (
              <table id={`settings-power-zones-${entry.sport}`} className="settings-table">
                <caption>{t('connectPage.settings.thresholds.zones.powerTitle', { sport })}</caption>
                <thead>
                  <tr>
                    <th scope="col">{t('connectPage.settings.thresholds.zones.zone')}</th>
                    <th scope="col">{t('connectPage.settings.thresholds.zones.upper')}</th>
                    <th scope="col">{t('connectPage.settings.columns.source')}</th>
                  </tr>
                </thead>
                <tbody>
                  {entry.powerZones.map((upper, at) => (
                    <tr key={at} data-power-zone>
                      <th scope="row">{t('connectPage.settings.thresholds.zones.name', { n: at + 1 })}</th>
                      <td>
                        {upper >= POWER_ZONE_OPEN_TOP_PERCENT
                          ? t('connectPage.settings.thresholds.zones.openTop')
                          : t('connectPage.settings.thresholds.zones.percentOfFtp', { value: upper })}
                      </td>
                      <td className="settings-source">
                        {t('connectPage.settings.thresholds.source.sportSettings')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        );
      })}
      <p className="note">{t('connectPage.settings.thresholds.zones.note')}</p>
    </div>
  );
}
