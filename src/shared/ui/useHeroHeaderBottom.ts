import { useContext } from 'react';
import { HeaderHeightContext } from 'expo-router/react-navigation';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Distance from the top of the screen to the bottom edge of the transparent native header drawn
 * over a hero, top inset included. The stack measures its bar and publishes the height, so this
 * follows the bar as the platform draws it: 56 dp on Android, 44 pt in iOS portrait, 32 in
 * landscape. The bar takes every touch on it, so anything a hero floats over its own top has to
 * start here. Outside a screen with a header only the status bar covers the top, so the inset is
 * the edge.
 */
export function useHeroHeaderBottom(): number {
  const measured = useContext(HeaderHeightContext);
  const insetTop = useSafeAreaInsets().top;
  return measured ?? insetTop;
}
