import { settings, type FitCourseFile, type GpsPoint, type GpxFile } from 'veloqrs';
import { getEngine } from './engine';

/**
 * The GPX file for one shared track, written by the engine with the athlete's
 * export privacy trim applied. Null when the trim leaves too little to be a
 * track. Throws when the engine is not open, since sharing the untrimmed track
 * would ignore the setting.
 */
export function buildGpxFile(
  name: string,
  sport: string | undefined,
  time: string | undefined,
  points: GpsPoint[]
): GpxFile | null {
  const engine = getEngine();
  if (!engine) throw new Error('Engine not available');
  return settings.buildGpxFile(name, sport, time, points);
}

/**
 * The GPX file for a route's representative track, read by the route's id so
 * the engine writes each point's elevation and the name the route is shown
 * under. Null when the trim leaves too little to be a track. Throws when the
 * engine is not open.
 */
export function buildRouteGpxFile(groupId: string, sport: string | undefined): GpxFile | null {
  return settings.buildRouteGpxFile(groupId, sport);
}

/**
 * The GPX file for a section's stored line, read by the section's id so the
 * engine writes each point's elevation and the name the section is shown
 * under. Null when the trim leaves too little to be a track. Throws when the
 * engine is not open.
 */
export function buildSectionGpxFile(sectionId: string, sport: string | undefined): GpxFile | null {
  return settings.buildSectionGpxFile(sectionId, sport);
}

/**
 * The FIT course file for a route's representative line, read by the route's
 * id through the same export privacy trim as the GPX file. Null when the trim
 * leaves too little to be a line. The engine's bytes are returned unchanged.
 */
export function buildRouteFitFile(
  groupId: string,
  sport: string | undefined
): FitCourseFile | null {
  return settings.buildRouteFitCourse(groupId, sport);
}

/**
 * The FIT course file for a section's stored line, read by the section's id
 * through the same export privacy trim as the GPX file. Null when the trim
 * leaves too little to be a line. The engine's bytes are returned unchanged.
 */
export function buildSectionFitFile(
  sectionId: string,
  sport: string | undefined
): FitCourseFile | null {
  return settings.buildSectionFitCourse(sectionId, sport);
}
