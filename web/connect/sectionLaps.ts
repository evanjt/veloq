// A section's laps as rows, and the writes that exclude or include them. The
// engine says which laps are counted and which are excluded; this only turns
// a selection of rows into the writes that change it, and into the writes that
// take it back. Pure, so a test drives it without a browser.

import type { Methods } from './schema';

type PerformanceRecord = Methods['section.performance']['result']['lapRecords'][number];

export type LapRow = {
  /** The lap's own id, which keys the table row. */
  id: string;
  activityId: string;
  activityName: string;
  /** Unix seconds of the activity. */
  date: number;
  direction: string;
  time: number;
  pace: number;
  avgHr: number | null;
  avgPower: number | null;
  startIndex: number;
  excluded: boolean;
  outsideBand: boolean;
  isRecord: boolean;
  match: number | null;
};

/** Every lap of every activity: newest activity first, an activity's laps in the order the engine gave. */
export function lapRows(records: readonly PerformanceRecord[]): LapRow[] {
  return records
    .map((record, at) => ({ record, at }))
    .sort((a, b) => b.record.activityDate - a.record.activityDate || a.at - b.at)
    .flatMap(({ record }) =>
      record.laps.map((lap) => ({
        id: lap.id,
        activityId: record.activityId,
        activityName: record.activityName,
        date: record.activityDate,
        direction: lap.direction,
        time: lap.time,
        pace: lap.pace,
        avgHr: lap.avgHr,
        avgPower: lap.avgPower,
        startIndex: lap.startIndex,
        excluded: lap.excluded,
        outsideBand: lap.outsideDistanceBand,
        isRecord: lap.isRecord,
        match: lap.matchPercentage,
      }))
    );
}

export type LapMethod =
  | 'section.excludeLap'
  | 'section.includeLap'
  | 'section.excludeActivity'
  | 'section.includeActivity';

export type LapWrite = {
  method: LapMethod;
  params: { id: string; activityId: string; startIndex?: number };
};

const lapWrite = (method: LapMethod, id: string, row: LapRow): LapWrite => ({
  method,
  params: { id, activityId: row.activityId, startIndex: row.startIndex },
});

/** One write for each of the rows that is still counted. */
export const excludeLaps = (sectionId: string, rows: readonly LapRow[]): LapWrite[] =>
  rows.filter((row) => !row.excluded).map((row) => lapWrite('section.excludeLap', sectionId, row));

/** One write for each of the rows that is excluded. */
export const includeLaps = (sectionId: string, rows: readonly LapRow[]): LapWrite[] =>
  rows.filter((row) => row.excluded).map((row) => lapWrite('section.includeLap', sectionId, row));

const activityWrites = (method: LapMethod, sectionId: string, rows: readonly LapRow[]) =>
  [...new Set(rows.map((row) => row.activityId))].map((activityId): LapWrite => ({
    method,
    params: { id: sectionId, activityId },
  }));

/** One write for each activity the rows belong to, however many of its laps are chosen. */
export const excludeActivities = (sectionId: string, rows: readonly LapRow[]): LapWrite[] =>
  activityWrites('section.excludeActivity', sectionId, rows);

export const includeActivities = (sectionId: string, rows: readonly LapRow[]): LapWrite[] =>
  activityWrites('section.includeActivity', sectionId, rows);

const INVERSE: Record<LapMethod, LapMethod> = {
  'section.excludeLap': 'section.includeLap',
  'section.includeLap': 'section.excludeLap',
  'section.excludeActivity': 'section.includeActivity',
  'section.includeActivity': 'section.excludeActivity',
};

/** The writes that take a batch back, last first. */
export const undoOf = (writes: readonly LapWrite[]): LapWrite[] =>
  writes
    .slice()
    .reverse()
    .map((write) => ({ ...write, method: INVERSE[write.method] }));
