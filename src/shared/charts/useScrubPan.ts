import { useMemo } from 'react';
import { I18nManager, useWindowDimensions } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue, type SharedValue } from 'react-native-reanimated';

import { useGestureCallback } from '@/shared/ui/useGestureCallback';
import { SCRUB_SLOP, scrubPanDecision } from './scrubPanDecision';

const noop = () => {};

/**
 * The pan every chart scrubs with. Manual activation keeps the touch
 * UNDETERMINED until it has travelled past the slop, so a vertical move fails
 * the scrub and the parent ScrollView keeps scrolling, and a horizontal one is
 * claimed with no hold, before a tab pager around the chart takes it.
 *
 * `touchX` follows the finger in chart-local pixels while the scrub runs and
 * reads -1 otherwise. `onActivate` runs on the JS thread when a scrub starts.
 */
export function useScrubPan(touchX: SharedValue<number>, onActivate?: () => void) {
  const { width: screenWidth } = useWindowDimensions();
  const isRTL = I18nManager.isRTL;
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const decided = useSharedValue(false);
  const onActivateOnJS = useGestureCallback(onActivate ?? noop);

  return useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .onTouchesDown((e) => {
          'worklet';
          const touch = e.allTouches[0];
          if (!touch || e.allTouches.length > 1) return;
          startX.value = touch.absoluteX;
          startY.value = touch.absoluteY;
          decided.value = false;
        })
        .onTouchesMove((e, mgr) => {
          'worklet';
          const touch = e.allTouches[0];
          if (decided.value || !touch) return;
          const decision = scrubPanDecision({
            startX: startX.value,
            translationX: touch.absoluteX - startX.value,
            translationY: touch.absoluteY - startY.value,
            screenWidth,
            isRTL,
            slop: SCRUB_SLOP,
          });
          if (decision === 'wait') return;
          decided.value = true;
          if (decision === 'fail') {
            mgr.fail();
            return;
          }
          runOnJS(onActivateOnJS)();
          mgr.activate();
        })
        .onTouchesUp((_e, mgr) => {
          'worklet';
          if (!decided.value) mgr.fail();
        })
        .onStart((e) => {
          'worklet';
          touchX.value = e.x;
        })
        .onUpdate((e) => {
          'worklet';
          touchX.value = e.x;
        })
        .onFinalize(() => {
          'worklet';
          touchX.value = -1;
        }),
    [startX, startY, decided, screenWidth, isRTL, touchX, onActivateOnJS]
  );
}
