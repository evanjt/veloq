import React from 'react';
import { TourRowsPicture, type TourRow } from './TourRowsPicture';

const ROWS: TourRow[] = [
  { icon: 'crosshairs-gps', labelKey: 'recording.fieldModeGps' },
  {
    icon: 'bike-fast',
    labelKey: 'recording.fieldModeIndoor',
    captionKey: 'recording.entryIndoorCaption',
  },
  { icon: 'pencil-outline', labelKey: 'recording.entryManualCaption' },
  { icon: 'bluetooth', labelKey: 'sensors.manageSensors' },
  {
    icon: 'record-circle-outline',
    labelKey: 'systemSurfaces.startRecording',
    captionKey: 'systemSurfaces.startRecordingDescription',
  },
];

/** The ways to record, the sensors and the shortcut that starts one. */
export function RecordingSlide() {
  return <TourRowsPicture rows={ROWS} testID="tour-recording-picture" />;
}
