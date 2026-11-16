// The settings hub: a list of the phone's screens beside the chosen one, each
// readable pane showing the phone's values.

import type { ParseKeys } from 'i18next';
import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';

import { DetectionPane } from '../DetectionPane';
import { ImportPane } from '../ImportPane';
import { ThresholdsPane } from '../ThresholdsPane';
import { deviceLines } from '../link';
import {
  DETECTION_SCREEN,
  ON_THE_PHONE,
  PANE_NOTE,
  PROFILE_SCREEN,
  SCREEN_SETTINGS,
  SETTINGS_GROUPS,
  THRESHOLDS_SCREEN,
  measurementKey,
  syncStateKey,
  pane,
  paneControls,
  readsScreen,
  type Pane,
} from '../settings';
import { ReadNotice } from '../shell/StatePanes';
import { useSettingsReads, type SettingsReads } from '../settingsReads';
import { Card as Panel, Select } from '../ui';
import { useSavedWrite } from '../useSavedWrite';
import type { PageProps } from './types';

/** A definition list of the facts that have a value. */
function Facts({ id, facts }: { id: string; facts: [label: string, value: string | null][] }) {
  return (
    <dl id={id} className="settings-facts">
      {facts
        .filter(([, value]) => value)
        .map(([label, value]) => (
          <Fragment key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </Fragment>
        ))}
    </dl>
  );
}

/** The phone's controls for a screen: a choice writes `settings.set`, a text is shown only. */
function SettingControls({ screen, reads }: { screen: string; reads: Readonly<SettingsReads> }) {
  const { t } = useTranslation();
  const controls = paneControls(screen, reads['settings.get']);
  const { save, refusal } = useSavedWrite(['settings.get']);
  return (
    <Panel label={t('connectPage.screens.settings')}>
      <ul id="settings-rows" className="settings-list">
        {controls.map((control) => (
          <li key={control.key} className="settings-row">
            {control.kind === 'choice' ? (
              <Select
                id={`setting-${control.key}`}
                label={t(control.label)}
                value={control.value ?? ''}
                onChange={(value) =>
                  void save(
                    { method: 'settings.set', params: { key: control.key, value } },
                    control.value === null
                      ? undefined
                      : {
                          previous: {
                            method: 'settings.set',
                            params: { key: control.key, value: control.value },
                          },
                        }
                  )
                }
                options={[
                  ...(control.value === null
                    ? [{ value: '', label: t('connectPage.settings.notSet') }]
                    : []),
                  ...control.options.map((option) => ({
                    value: option.value,
                    label: t(option.label),
                  })),
                ]}
              />
            ) : (
              <>
                <span className="settings-label">{t(control.label)}</span>
                <span className="settings-value">
                  {control.value ?? t('connectPage.settings.notSet')}
                </span>
              </>
            )}
          </li>
        ))}
      </ul>
      {refusal ? (
        <p id="settings-notice" role="alert">
          {refusal}
        </p>
      ) : null}
    </Panel>
  );
}

/** The library's state on the phone: sync, what is downloaded, the cache and detection. */
function LibraryStatus({ reads }: { reads: Readonly<SettingsReads> }) {
  const { t } = useTranslation();
  const coverage = reads['status.coverage'];
  const cache = reads['status.cache'];
  const jobs = reads['status.backgroundJobs'];
  const sync = reads['status.sync'];
  return (
    <Facts
      id="settings-status"
      facts={[
        [
          t('connectPage.settings.sync'),
          sync
            ? syncStateKey(sync.state)
              ? t(syncStateKey(sync.state) as ParseKeys)
              : sync.state
            : null,
        ],
        [
          t('connectPage.settings.activitiesOnPhone'),
          coverage && coverage.upstream > 0 ? `${coverage.fetched} of ${coverage.upstream}` : null,
        ],
        [
          t('connectPage.settings.tracksOnPhone'),
          coverage && coverage.tracksUpstream > 0
            ? `${coverage.tracksStored} of ${coverage.tracksUpstream}`
            : null,
        ],
        [
          t('connectPage.settings.streamCache'),
          cache ? `${(cache.streamStoreBytes / 1e6).toFixed(1)} MB` : null,
        ],
        [
          t('connectPage.settings.awaitingDetection'),
          jobs?.detectionAwaiting == null ? null : String(jobs.detectionAwaiting),
        ],
      ]}
    />
  );
}

/**
 * What the phone holds for a readable screen, read-only, or nothing when the
 * page does not read that screen's values.
 */
function ScreenReadout({ screen, reads }: { screen: string; reads: Readonly<SettingsReads> }) {
  const { t } = useTranslation();
  if (screen === PROFILE_SCREEN) return <Profile reads={reads} />;
  if (screen in SCREEN_SETTINGS) return <SettingControls screen={screen} reads={reads} />;
  if (screen === 'linked-devices') {
    const devices = reads['status.linkedDevices'];
    return (
      <ul id="settings-devices">
        {(devices ? deviceLines(devices) : []).map((line, at) => (
          <li key={at}>
            {line.thisBrowser
              ? t('connectPage.settings.deviceThisBrowser', { name: line.name })
              : line.name}
          </li>
        ))}
      </ul>
    );
  }
  if (screen === 'backup-settings') {
    return (
      <Facts
        id="settings-backup"
        facts={[
          [
            t('connectPage.settings.backup'),
            reads['status.backup'] ? t('connectPage.settings.backupSetUp') : null,
          ],
        ]}
      />
    );
  }
  return <LibraryStatus reads={reads} />;
}

/** The athlete's profile, each value with where the phone got it. */
function Profile({ reads }: { reads: Readonly<SettingsReads> }) {
  const { t } = useTranslation();
  const profile = reads['settings.profile'];
  const units = measurementKey(profile?.measurementPreference);
  const rows: [label: string, value: string | null][] = [
    [t('connectPage.settings.name'), profile?.name ?? null],
    [t('connectPage.settings.units'), units ? t(units) : (profile?.measurementPreference ?? null)],
    [t('connectPage.settings.weight'), profile?.weightKg == null ? null : `${profile.weightKg} kg`],
  ];
  return (
    <table id="settings-profile" className="settings-table">
      <thead>
        <tr>
          <th scope="col">{t('connectPage.settings.columns.setting')}</th>
          <th scope="col">{t('connectPage.settings.columns.value')}</th>
          <th scope="col">{t('connectPage.settings.columns.source')}</th>
        </tr>
      </thead>
      <tbody>
        {rows
          .filter(([, value]) => value)
          .map(([label, value]) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>{value}</td>
              <td className="settings-source">{t('connectPage.settings.source.intervals')}</td>
            </tr>
          ))}
      </tbody>
    </table>
  );
}

/** The phone's settings hub as a list on the left and the chosen screen on the right. */
function SettingsPane({ id, reads }: { id: string | null; reads: Readonly<SettingsReads> }) {
  const { t } = useTranslation();
  return (
    <section id="settings" className="settings-page">
      <nav id="settings-list" aria-label={t('connectPage.screens.settings')}>
        {SETTINGS_GROUPS.map((group) => (
          <div key={group.title} className="settings-group">
            <h2>{t(group.title)}</h2>
            <ul>
              {group.rows.map((row) => (
                <li key={row.screen}>
                  <a href={`#/settings/${row.screen}`} aria-current={id === row.screen}>
                    {t(row.title)}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="settings-group">
          <h2>{t('connectPage.settings.onThePhone')}</h2>
          <ul>
            {ON_THE_PHONE.map((entry) => (
              <li key={entry.title}>
                {entry.screen ? (
                  <a href={`#/settings/${entry.screen}`} aria-current={id === entry.screen}>
                    {t(entry.title)}
                  </a>
                ) : (
                  t(entry.title)
                )}
              </li>
            ))}
          </ul>
        </div>
      </nav>
      <div id="settings-pane" className="settings-form">
        <SettingsBody shown={pane(id)} screen={id} reads={reads} />
      </div>
    </section>
  );
}

function SettingsBody({
  shown,
  screen,
  reads,
}: {
  shown: Pane;
  screen: string | null;
  reads: Readonly<SettingsReads>;
}) {
  const { t } = useTranslation();
  if (shown.kind === 'readable' && screen === DETECTION_SCREEN) {
    return (
      <>
        <h3 id="settings-title" className="panel-title">
          {t(shown.title)}
        </h3>
        <DetectionPane />
      </>
    );
  }
  if (shown.kind === 'readable' && screen === THRESHOLDS_SCREEN) {
    return (
      <>
        <h3 id="settings-title" className="panel-title">
          {t(shown.title)}
        </h3>
        <ThresholdsPane />
      </>
    );
  }
  if (shown.kind === 'readable') {
    return (
      <>
        <h3 id="settings-title" className="panel-title">
          {t(shown.title)}
        </h3>
        {shown.note ? <p className="note">{t(shown.note)}</p> : null}
        {screen && readsScreen(screen) ? <ScreenReadout screen={screen} reads={reads} /> : null}
      </>
    );
  }
  if (shown.kind === 'phone') {
    return (
      <>
        <h3 id="settings-title" className="panel-title">
          {t(shown.title)}
        </h3>
        <p>{t(shown.why)}</p>
        <p className="note">{t('connectPage.settings.openOnPhone')}</p>
      </>
    );
  }
  if (shown.kind === 'unknown') {
    return (
      <>
        <h3 id="settings-title" className="panel-title">
          {t('connectPage.settings.notOnBrowser')}
        </h3>
        <p>{t('connectPage.settings.notOnBrowserBody')}</p>
      </>
    );
  }
  return (
    <>
      <h3 id="settings-title" className="panel-title">
        {t('connectPage.settings.pick')}
      </h3>
      <p className="note">{t(PANE_NOTE)}</p>
      <h3>{t('connectPage.settings.profile')}</h3>
      <Profile reads={reads} />
      <h3>{t('connectPage.settings.libraryStatus')}</h3>
      <LibraryStatus reads={reads} />
    </>
  );
}

export function SettingsPage({ session, snapshot, route }: PageProps) {
  const { reads, errors } = useSettingsReads();
  const first = Object.values(errors)[0];
  return (
    <>
      {first && Object.keys(reads).length === 0 ? <ReadNotice error={first} /> : null}
      <SettingsPane id={route.id} reads={reads} />
      {route.id === null ? (
        <ImportPane
          upload={snapshot.upload}
          notice={snapshot.writeNotice}
          importArchive={session.importArchive}
        />
      ) : null}
    </>
  );
}
