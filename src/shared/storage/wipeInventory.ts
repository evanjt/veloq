import type { TFunction } from 'i18next';

/** What `wipeLibrary` leaves of one kind of the athlete's data. */
export type WipeFate = 'returns' | 'deleted' | 'kept';

/**
 * Every kind of data the athlete would know by name, and its fate at the wipe:
 * synced again from intervals.icu at the next sign-in, deleted for good, or
 * left on the phone. The confirm of Sign out and delete data is built from
 * this, so consent is given on the list the wipe actually carries out.
 *
 * A kind the wipe starts or stops deleting changes here, and the device-write
 * inventory of the wipe's own suite names the line each place it takes falls
 * under.
 */
export const WIPE_INVENTORY = {
  activities: 'returns',
  wellness: 'returns',
  detectedSections: 'returns',
  localBackups: 'deleted',
  backupSetup: 'deleted',
  names: 'deleted',
  sectionEdits: 'deleted',
  sensors: 'deleted',
  exportPrivacy: 'deleted',
  notificationChoices: 'deleted',
  mapChoices: 'deleted',
  recordings: 'kept',
} as const satisfies Record<string, WipeFate>;

export type WipeLine = keyof typeof WIPE_INVENTORY;

const FATES: readonly WipeFate[] = ['returns', 'deleted', 'kept'];

/** The lines of one fate, in the order the confirm shows them. */
export function wipeLines(fate: WipeFate): WipeLine[] {
  return (Object.keys(WIPE_INVENTORY) as WipeLine[]).filter(
    (line) => WIPE_INVENTORY[line] === fate
  );
}

const HEADING: Record<WipeFate, (t: TFunction) => string> = {
  returns: (t) => t('alerts.wipeList.returns'),
  deleted: (t) => t('alerts.wipeList.deleted'),
  kept: (t) => t('alerts.wipeList.kept'),
};

const LINE: Record<WipeLine, (t: TFunction) => string> = {
  activities: (t) => t('alerts.wipeList.activities'),
  wellness: (t) => t('alerts.wipeList.wellness'),
  detectedSections: (t) => t('alerts.wipeList.detectedSections'),
  localBackups: (t) => t('alerts.wipeList.localBackups'),
  backupSetup: (t) => t('alerts.wipeList.backupSetup'),
  names: (t) => t('alerts.wipeList.names'),
  sectionEdits: (t) => t('alerts.wipeList.sectionEdits'),
  sensors: (t) => t('alerts.wipeList.sensors'),
  exportPrivacy: (t) => t('alerts.wipeList.exportPrivacy'),
  notificationChoices: (t) => t('alerts.wipeList.notificationChoices'),
  mapChoices: (t) => t('alerts.wipeList.mapChoices'),
  recordings: (t) => t('alerts.wipeList.recordings'),
};

/** One line of the confirm, as the athlete reads it. */
export function wipeLineText(line: WipeLine, t: TFunction): string {
  return LINE[line](t);
}

/**
 * The message of the Sign out and delete data confirm: what it does, then each
 * fate under its heading with every line of it.
 */
export function wipeConfirmMessage(t: TFunction): string {
  const lists = FATES.map((fate) =>
    [HEADING[fate](t), ...wipeLines(fate).map((line) => `• ${LINE[line](t)}`)].join('\n')
  );
  return [t('alerts.disconnectAndClearMessage'), ...lists].join('\n\n');
}
