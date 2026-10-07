/**
 * What the rest of the tree takes from this feature, by name. A star export
 * would hide a collision between two modules exporting the same identifier and
 * would leave the layering lint nothing to count.
 *
 * Each line names the sub-barrel rather than the file under it, so a test that
 * mocks `@/features/activity/components` still intercepts what the outside tree
 * takes through here.
 *
 * `activityUtils` and `activityMetrics` are not here. It is pure helpers over an activity's type, no
 * feature state and no component, and every feature reads it: leaving it inside
 * this barrel made maps import the whole activity feature to colour an icon,
 * and `ActivityCard` read back into the maps barrel while it was still being
 * built. It lives at `@/shared/activity/activityUtils` for that reason.
 *
 * `./demo` is not among them. It re-exports `getWellness` from the fitness
 * feature, whose demo module reads the activity fixtures back, and the demo
 * seeder needs those fixtures before any native module exists. `fixtures` and
 * `ApiWellness` come off their own leaves instead.
 */

export {
  ActivityCard,
  ActivityCardContextMenu,
  ActivityChartsSection,
  ActivityHeader,
  ActivityRoutesSection,
  ActivityDetailReadFailed,
  ActivityDetailSkeleton,
  ActivitySectionsSection,
  SkylineBar,
} from './components';

export { fixtures } from '@/shared/demo/activity/activities';
export type { ApiWellness } from '@/shared/demo/activity/types';

export {
  getLatestFTP,
  useActivities,
  useActivity,
  useActivityBoundsCache,
  useActivityIntervals,
  useActivitySectionHighlights,
  useActivityStreams,
  useActivityDetailStreams,
  useDetailCoordinates,
  useFeedSearch,
  useInfiniteActivities,
  useSectionOverlays,
} from './hooks';
export { useActivityDetailData } from './hooks/useActivityDetailData';
export { useActivityLabels } from './hooks/useActivityLabels';

export type { ChartConfig, ChartTypeId } from './lib/chartConfig';
export { FEED_GROUPS } from './lib/feedActivityGroups';
export { feedRangeForPreset, sameFeedRange } from './lib/feedRange';
export type { FeedRange, FeedRangePreset } from './lib/feedRange';
export { useRangeActivities } from './hooks/useActivities';
export { FeedFilterChips } from './components/FeedFilterChips';
export { storableTimeStreams } from '@/shared/demo/activity/streams';
export { ESTIMATED_SEARCH_SECTION_HEIGHT, searchOffsetCorrection } from './lib/feedSearchOffset';
export type { FeedGroup } from './lib/feedActivityGroups';
export { groupSectionEncounters, sectionRowLabels } from './lib/groupSectionEncounters';
export { decouplingSource, storedDecoupling } from './lib/decoupling';
export type { DecouplingSource } from './lib/decoupling';
export type { SectionEncounterGroup } from './lib/groupSectionEncounters';
export { setVisibleRange } from './lib/previewRange';
export { ringsLeavingView } from './lib/ringsLeavingView';

export type { ActivityType } from './types';
