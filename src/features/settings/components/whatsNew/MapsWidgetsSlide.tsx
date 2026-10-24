import React from 'react';
import { TourRowsPicture, type TourRow } from './TourRowsPicture';

const ROWS: TourRow[] = [
  { icon: 'terrain', labelKey: 'settings.terrain3D', captionKey: 'settings.terrain3DSmart' },
  {
    icon: 'widgets-outline',
    labelKey: 'systemSurfaces.summary',
    captionKey: 'systemSurfaces.summaryDescription',
  },
  {
    icon: 'arm-flex-outline',
    labelKey: 'whatsNew.v030.strengthTitle',
    captionKey: 'systemSurfaces.strengthDescription',
  },
];

/** The 3D terrain setting and the two widgets, with the words their own screens use. */
export function MapsWidgetsSlide() {
  return <TourRowsPicture rows={ROWS} testID="tour-maps-widgets-picture" />;
}
