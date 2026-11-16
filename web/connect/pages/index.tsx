// The page components, by the page the router names. The page table in
// `pages.ts` holds each page's title and place; this holds what it draws.

import type { ComponentType } from 'react';
import { useTranslation } from 'react-i18next';

import type { PageKey } from '../pages';
import { MapPage } from './Map';
import { ActivityRoute } from './ActivityPage';
import { FitnessPage, InsightsPage } from './Dashboard';
import { ExercisePage } from './Exercise';
import { FeedPage } from './Feed';
import { LivePage } from './LivePage';
import { RecordingPage } from './Recording';
import { RecordingsPage } from './Recordings';
import { RoutesPage } from './RoutesPage';
import { SectionDetailPage } from './SectionDetailPage';
import { SectionsPage } from './SectionsPage';
import { SettingsPage } from './Settings';
import { StrengthPage } from './Strength';
import type { PageProps } from './types';
import { WorkoutsPage } from './WorkoutsPage';

function LaterPage() {
  const { t } = useTranslation();
  return (
    <section id="later">
      <p>{t('connectPage.laterScreen')}</p>
    </section>
  );
}

/** A saved workout and a new one are different drafts, so the builder starts over between them. */
function WorkoutBuilder(props: PageProps) {
  return <WorkoutsPage key={props.route.id ?? 'new'} {...props} />;
}

/** The sections list, or one section: the address says which. */
function SectionsRoute(props: PageProps) {
  return props.route.screen === 'section' ? (
    <SectionDetailPage key={props.route.id} route={props.route} />
  ) : (
    <SectionsPage route={props.route} />
  );
}

export const PAGES: Record<PageKey, ComponentType<PageProps>> = {
  feed: FeedPage,
  activity: ActivityRoute,
  map: MapPage,
  routes: RoutesPage,
  sections: SectionsRoute,
  fitness: FitnessPage,
  insights: InsightsPage,
  strength: StrengthPage,
  exercise: ExercisePage,
  workouts: WorkoutBuilder,
  live: () => <LivePage />,
  recordings: RecordingsPage,
  recording: RecordingPage,
  settings: SettingsPage,
  later: LaterPage,
};
