import { StyleSheet } from 'react-native';

import { layers, layout } from '@/theme';
import { MAP_CONTROL_GAP } from './MapControlButton';

export const styles = StyleSheet.create({
  outerContainer: {
    position: 'relative',
  },
  container: {
    flex: 1,
    borderRadius: layout.borderRadius,
    overflow: 'hidden',
  },
  mapLayer: {
    ...StyleSheet.absoluteFill,
  },
  map3DLayer: {
    zIndex: layers.raised,
  },
  loadingCue: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: layers.mapOverlay,
  },
  map: {
    flex: 1,
  },
  placeholder: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: layout.borderRadius,
  },
  controlsContainer: {
    position: 'absolute',
    right: layout.cardMargin,
    gap: MAP_CONTROL_GAP,
    // Further columns go to the left, so the first stays on the map's edge.
    flexWrap: 'wrap-reverse',
    justifyContent: 'flex-start',
    zIndex: layers.mapOverlay,
  },
});
