import React from 'react';
import { TourRowsPicture, type TourRow } from './TourRowsPicture';

const ROWS: TourRow[] = [
  {
    icon: 'history',
    labelKey: 'whatsNew.v040.changesSectionsLabel',
    captionKey: 'whatsNew.v040.changesSectionsCaption',
  },
  {
    icon: 'chart-line-variant',
    labelKey: 'whatsNew.v040.changesVisitsLabel',
    captionKey: 'whatsNew.v040.changesVisitsCaption',
  },
  {
    icon: 'cloud-off-outline',
    labelKey: 'whatsNew.v040.changesBackupLabel',
    captionKey: 'whatsNew.v040.changesBackupCaption',
  },
  {
    icon: 'tune-variant',
    labelKey: 'whatsNew.v040.changesDetectionLabel',
    captionKey: 'whatsNew.v040.changesDetectionCaption',
  },
  {
    icon: 'bell-outline',
    labelKey: 'whatsNew.v040.changesNotificationsLabel',
    captionKey: 'whatsNew.v040.changesNotificationsCaption',
  },
  {
    icon: 'phone-rotate-portrait',
    labelKey: 'whatsNew.v040.changesPortraitLabel',
    captionKey: 'whatsNew.v040.changesPortraitCaption',
  },
];

/** The changes an upgrader meets without asking for them, one row each, so none is only in the notes. */
export function ChangesSlide() {
  return <TourRowsPicture rows={ROWS} testID="tour-changes-picture" />;
}
