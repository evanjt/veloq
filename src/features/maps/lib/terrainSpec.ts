import type { MapTerrainSpec } from '@/features/maps/lib/htmlBuilders/mapSurface';
import { TERRAIN_3D_CONFIG } from '@/features/maps/components/mapStyles';

interface SubjectTerrainInput {
  /** The geojson source holding the line the camera must keep in view. */
  subjectSource: string;
  /** The tilt to ease to, in degrees. Defaults to the shared 3D tilt. */
  pitch?: number | undefined;
  /** A camera the athlete chose or one already shown, which a ridge never turns. */
  pinned?: boolean | undefined;
}

/**
 * The terrain spec every detail map in 3D hands the surface, so the line that
 * must stay visible, the tilt and the pin are written once.
 */
export function buildSubjectTerrain({
  subjectSource,
  pitch = TERRAIN_3D_CONFIG.defaultPitch,
  pinned = false,
}: SubjectTerrainInput): MapTerrainSpec {
  return {
    exaggeration: TERRAIN_3D_CONFIG.defaultExaggeration,
    pitch,
    subjectSource,
    cameraPinned: pinned,
  };
}
