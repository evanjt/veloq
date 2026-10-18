/** The ride the Fitness card reports, and the value intervals.icu stored for it. */
export interface DecouplingSource {
  activityId: string;
  name: string;
  /** `start_date_local` as stored. */
  date: string;
  /** Percentage, as intervals.icu computed it. */
  decoupling: number;
}
