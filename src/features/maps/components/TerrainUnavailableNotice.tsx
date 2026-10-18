import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { spacing } from '@/theme';
import { FloatingPill } from '@/shared/ui/FloatingPill';

export const TERRAIN_UNAVAILABLE_TEST_ID = 'terrain-unavailable-notice';

/** Where the notice sits: at the foot of an embedded map, or in the screen's bottom pill stack. */
export type TerrainNoticePlacement = 'mapFoot' | 'pillStack';

const DISMISS_AFTER_MS = 6000;

/**
 * Says why a 3D view dropped back to the flat map. The renderer ships in the
 * app but the DEM tiles do not, so an offline 3D open used to leave a flat map
 * that read as broken 3D.
 *
 * It is a status pill and clears itself, because the athlete cannot act on it
 * while offline and a pill that has to be dismissed is worse than the silence it
 * replaced. So it speaks as it appears, since a screen reader may not reach it
 * before it goes, and passes every touch through to the map under it.
 *
 * At `mapFoot` it floats at the foot of the map it explains. In `pillStack` it lays out in the
 * bottom pill stack's slot, which places it.
 */
export function TerrainUnavailableNotice({
  onDismiss,
  placement = 'mapFoot',
}: {
  onDismiss: () => void;
  placement?: TerrainNoticePlacement;
}) {
  const { t } = useTranslation();
  const message = t('maps.threeDUnavailable');

  // Callers pass a fresh arrow each render, so keying the timer on it would restart the clock.
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => {
    const timer = setTimeout(() => dismissRef.current(), DISMISS_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={placement === 'mapFoot' ? styles.mapFoot : styles.pillStack} pointerEvents="none">
      <FloatingPill
        icon="terrain"
        title={message}
        announcement={message}
        testID={TERRAIN_UNAVAILABLE_TEST_ID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  mapFoot: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.xl,
    alignItems: 'center',
  },
  pillStack: {
    marginHorizontal: spacing.md,
    alignItems: 'center',
  },
});
