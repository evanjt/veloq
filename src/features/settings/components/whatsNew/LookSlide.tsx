import React from 'react';
import { TourRowsPicture, type TourRow } from './TourRowsPicture';

const ROWS: TourRow[] = [
  { icon: 'home', labelKey: 'navigation.feed' },
  { icon: 'chart-box', labelKey: 'navigation.fitness' },
  { icon: 'map', labelKey: 'navigation.map' },
  { icon: 'lightbulb', labelKey: 'navigation.insights' },
  { icon: 'cog', labelKey: 'navigation.settingsTab' },
];

/** The redesigned tab bar's five tabs, named as the bar names them. */
export function LookSlide() {
  return <TourRowsPicture rows={ROWS} testID="tour-look-picture" />;
}
