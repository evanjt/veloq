import { useCallback, useRef } from 'react';
import { useMapPreferences, type ActivityCameraState } from '@/features/settings';
import type { MapStyleType, TerrainCamera } from '@/features/maps';

/**
 * The choices the athlete makes on one activity's map, written as that
 * activity's override: its style, its 3D mode, and the camera angle a gesture
 * left in 3D.
 */
export function useActivityMapChoices(activityId: string | undefined) {
  const {
    setActivityOverride,
    getActivityOverride,
    getActivityCamera,
    captureActivityCamera,
    restoreActivityCamera,
  } = useMapPreferences();
  const beforeCaptureRef = useRef<ActivityCameraState | null>(null);

  const on3DModeChange = useCallback(
    (is3D: boolean) => {
      if (activityId) setActivityOverride(activityId, { terrain3D: is3D });
    },
    [activityId, setActivityOverride]
  );

  const onStyleChange = useCallback(
    (style: MapStyleType) => {
      if (activityId) setActivityOverride(activityId, { style });
    },
    [activityId, setActivityOverride]
  );

  const onCameraCapture = useCallback(
    (camera: TerrainCamera) => {
      if (!activityId) return;
      beforeCaptureRef.current = {
        terrain3D: getActivityOverride(activityId)?.terrain3D,
        camera: getActivityCamera(activityId),
      };
      captureActivityCamera(activityId, camera);
    },
    [activityId, getActivityOverride, getActivityCamera, captureActivityCamera]
  );

  const undoCameraCapture = useCallback(() => {
    const before = beforeCaptureRef.current;
    if (!activityId || !before) return;
    beforeCaptureRef.current = null;
    restoreActivityCamera(activityId, before);
  }, [activityId, restoreActivityCamera]);

  return { on3DModeChange, onStyleChange, onCameraCapture, undoCameraCapture };
}
