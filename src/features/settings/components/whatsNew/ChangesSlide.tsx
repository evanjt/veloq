import React from 'react';
import { Platform } from 'react-native';
import { TourRowsPicture, type TourRow } from './TourRowsPicture';

// Built per render, so the backup caption follows the platform the slide is drawn on.
function rows(): TourRow[] {
  return [
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
      captionKey:
        Platform.OS === 'android'
          ? 'whatsNew.v040.changesBackupCaptionAndroid'
          : 'whatsNew.v040.changesBackupCaption',
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
}

/** The changes an upgrader meets without asking for them, one row each, so none is only in the notes. */
export function ChangesSlide() {
  return <TourRowsPicture rows={rows()} testID="tour-changes-picture" />;
}
