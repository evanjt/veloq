import React from 'react';
import { TourRowsPicture, type TourRow } from './TourRowsPicture';

const ROWS: TourRow[] = [
  { icon: 'history', labelKey: 'sectionHistory.title', captionKey: 'sectionHistory.versions' },
  { icon: 'undo-variant', labelKey: 'sectionHistory.revert' },
];

/** A section's history and the revert beside each stored version, named as the section page names them. */
export function SectionsRebuiltSlide() {
  return <TourRowsPicture rows={ROWS} testID="tour-sections-rebuilt-picture" />;
}
