/**
 * The one-time notice that the activity library was rebuilt.
 *
 * A database that cannot be opened or migrated is renamed aside and a fresh one
 * takes its place. The athlete then opens the app to an empty feed, an empty
 * routes tab and a sync starting from nothing, which is indistinguishable from
 * a first install for however long the resync takes. Their sections, the
 * ledger, the pins and the suppressions all came across, and until this card
 * nothing said so. When nothing could be carried across, the card still says
 * the library was rebuilt, without a kept list.
 *
 * An engine open captures the one-shot report, including an open after this
 * notice mounted on the login screen. The notice is the platform alert, raised
 * once when the report appears; its button and an Android dismiss both clear
 * the report.
 */
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useEngineStatus } from '@/features/routes';

import { quarantineNoticeParts, type QuarantineNoticeKey } from '../lib/quarantineNotice';
import { clearQuarantineReport } from '../lib/quarantineReport';

/**
 * Spelled out rather than built from the key, so the unused-key guard can see
 * every one of them. A template prefix would need an exemption, and the
 * exemption is what stops the guard noticing when one of these is dropped.
 */
const KEPT_KEY = {
  recordings: 'engine.quarantine.kept.recordings',
  routeNames: 'engine.quarantine.kept.routeNames',
  sections: 'engine.quarantine.kept.sections',
  history: 'engine.quarantine.kept.history',
  geometry: 'engine.quarantine.kept.geometry',
  pins: 'engine.quarantine.kept.pins',
  intents: 'engine.quarantine.kept.intents',
} as const satisfies Record<QuarantineNoticeKey, string>;

export function LibraryRebuiltNotice() {
  const { t } = useTranslation();
  const report = useEngineStatus((s) => s.quarantineReport);

  const announced = useRef<typeof report>(null);

  useEffect(() => {
    const parts = quarantineNoticeParts(report);
    // A language change re-creates `t`; the same report is not announced twice.
    if (!parts || announced.current === report) return;
    announced.current = report;

    const kept = parts
      .map((part) => t(KEPT_KEY[part.key], { count: part.count }))
      .join(t('engine.quarantine.separator'));
    const keptLine =
      parts.length > 0
        ? t('engine.quarantine.kept.lead', { kept })
        : t('engine.quarantine.keptNothing');

    Alert.alert(
      t('engine.quarantine.title'),
      `${keptLine}\n${t('engine.quarantine.resyncing')}`,
      [{ text: t('engine.quarantine.dismiss'), onPress: clearQuarantineReport }],
      { cancelable: true, onDismiss: clearQuarantineReport }
    );
  }, [report, t]);

  return null;
}
