import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  useWindowDimensions,
  type AccessibilityActionEvent,
  type LayoutChangeEvent,
} from 'react-native';
import { FullWindowModal } from '@/shared/ui/FullWindowModal';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  type SharedValue,
} from 'react-native-reanimated';
import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { navigateTab } from '@/shared/app/navigation';
import { useTheme } from '@/shared/app';
import { useReduceMotion } from '@/shared/ui/reduceMotion';
import { useGestureCallback } from '@/shared/ui/useGestureCallback';
import {
  colors,
  darkColors,
  spacing,
  layout,
  ink,
  colorWithOpacity,
  duration,
  easing,
} from '@/theme';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { useCutoverSummary, useGroupSummaries, useSectionSummaries } from '@/features/routes';
import { cutoverHasChangesToShow } from '@/features/settings/lib/cutoverShowMe';
import { setUpInSettings } from '@/features/settings/lib/tourSetUp';
import {
  resolveShowMeRoute,
  SHOW_ME_MIN_VISITS,
  type TourLibrary,
} from '@/features/settings/lib/tourShowMe';
import { useActivityCount } from '@/shared/native/useActivityCount';
import {
  TOUR_CARD_HEIGHT_RATIO,
  TOUR_FOOTER_GAP,
  tourCardWidth,
  tourFooterLayout,
  tourSlideAreaHeight,
} from '../../lib/tourSlideFit';
import { tourPageOffset } from '../../lib/tourPageOffset';
import { tourResumeMotion } from '../../lib/tourResume';
import {
  getAllSlides,
  getSlidesSince,
  getTutorialSlidesFor,
  type WhatsNewSlideDefinition,
} from './slides';
import { WhatsNewSlide } from './WhatsNewSlide';
import { TourSyncLine } from './TourSyncLine';
import { Button, pageAccessibility } from '@/shared/ui';
import { useAnnounceOnAppear } from '@/shared/ui/useAnnounceOnAppear';

const SWIPE_THRESHOLD_RATIO = 0.2;
const VELOCITY_THRESHOLD = 400;
const TIMING_CONFIG = { duration: duration.standard, easing: easing.standard };
// The modal's own fade, which the resume slide waits out so the slide across is seen.
const ENTER_FADE_MS = duration.slow;

const ALL_SLIDES = getAllSlides();

function withoutShowMe(slide: WhatsNewSlideDefinition): WhatsNewSlideDefinition {
  const {
    showMeRoute: _route,
    showMeTip: _tip,
    showMeWhen: _when,
    showMeAction: _action,
    ...content
  } = slide;
  return content;
}

export function WhatsNewModal() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [overlayHeight, setOverlayHeight] = useState(0);
  const [chromeHeight, setChromeHeight] = useState(0);
  const slideAreaHeight = tourSlideAreaHeight(overlayHeight || windowHeight, chromeHeight);
  const contentWidth = tourCardWidth(windowWidth);
  const swipeThreshold = contentWidth * SWIPE_THRESHOLD_RATIO;
  const reduceMotion = useReduceMotion();
  const isLoaded = useWhatsNewStore((s) => s.isLoaded);
  const lastSeenVersion = useWhatsNewStore((s) => s.lastSeenVersion);
  const tourState = useWhatsNewStore((s) => s.tourState);
  const markSeen = useWhatsNewStore((s) => s.markSeen);
  const startTour = useWhatsNewStore((s) => s.startTour);
  const showMe = useWhatsNewStore((s) => s.showMe);
  const dismissTour = useWhatsNewStore((s) => s.dismissTour);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isDemoMode = useAuthStore((s) => s.isDemoMode);
  const cutover = useCutoverSummary();
  const cutoverChanged = cutoverHasChangesToShow(cutover);
  // Read only while the card is up, so a closed tour costs the routes reads nothing.
  const tourOpen = !!tourState && !tourState.exploring;
  const busiestSectionId = useSectionSummaries({
    minVisits: SHOW_ME_MIN_VISITS,
    enabled: tourOpen,
  }).summaries[0]?.id;
  const busiestRouteId = useGroupSummaries({
    minActivities: SHOW_ME_MIN_VISITS,
    sortBy: 'count',
    enabled: tourOpen,
  }).summaries[0]?.groupId;
  const hasActivities = useActivityCount() > 0;
  const library = useMemo<TourLibrary>(
    () => ({
      hasActivities,
      sectionId: busiestSectionId,
      routeId: busiestRouteId,
      cutoverChanged,
    }),
    [hasActivities, busiestSectionId, busiestRouteId, cutoverChanged]
  );

  const currentVersion = Constants.expoConfig?.version ?? '';
  const missedSlides = lastSeenVersion ? getSlidesSince(lastSeenVersion) : [];

  // The tour never opens on its own: a first load opens onto the feed, where a card offers it.
  // A version with nothing new is seen at once; one with slides waits for its card.
  const markedSeen = useRef(false);
  useEffect(() => {
    if (!isLoaded || !isAuthenticated || isDemoMode || markedSeen.current || tourState) return;
    if (
      lastSeenVersion !== null &&
      lastSeenVersion !== currentVersion &&
      missedSlides.length === 0
    ) {
      markedSeen.current = true;
      markSeen(currentVersion);
    }
  }, [
    isLoaded,
    isAuthenticated,
    isDemoMode,
    lastSeenVersion,
    currentVersion,
    missedSlides.length,
    tourState,
    markSeen,
  ]);

  const tourSlides =
    tourState?.mode === 'tutorial'
      ? getTutorialSlidesFor(tourState.only, tourState.held)
      : missedSlides.length > 0
        ? missedSlides
        : ALL_SLIDES;
  const slides = useMemo(
    () =>
      tourSlides.map((slide): WhatsNewSlideDefinition =>
        resolveShowMeRoute(slide, library) === undefined ? withoutShowMe(slide) : slide
      ),
    [tourSlides, library]
  );
  const slideCount = slides.length;

  const translateX = useSharedValue(0);
  const activeIndex = useSharedValue(0);
  // The shared value drives the gesture on the UI thread; this mirror of it is what
  // the footer, the pager value and the slides' accessibility render from. Every
  // move goes through `placeSlide` or the gesture's end, which set both.
  const [currentIndex, setCurrentIndex] = useState(0);

  const placeSlide = useCallback(
    (index: number, animate: boolean) => {
      activeIndex.value = index;
      const offset = tourPageOffset(index, contentWidth);
      translateX.value = animate ? withTiming(offset, TIMING_CONFIG) : offset;
      setCurrentIndex(index);
    },
    [translateX, activeIndex, contentWidth]
  );

  // A fold, split screen or rotation resizes the card at once, so the row moves with it
  // or the card shows parts of two slides.
  useEffect(() => {
    translateX.value = tourPageOffset(activeIndex.value, contentWidth);
  }, [contentWidth, translateX, activeIndex]);

  const dismiss = useCallback(() => {
    dismissTour(currentVersion, setUpInSettings());
  }, [currentVersion, dismissTour]);

  const goToSlide = useCallback((index: number) => placeSlide(index, true), [placeSlide]);

  // The card fades in before the carousel moves, so the slide across is seen.
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelResumeSlide = useCallback(() => {
    if (resumeTimer.current !== null) clearTimeout(resumeTimer.current);
    resumeTimer.current = null;
  }, []);
  useEffect(() => cancelResumeSlide, [cancelResumeSlide]);

  // Place the carousel when the tour opens, switches mode or comes back from Show Me.
  const prevMode = useRef<string | null>(null);
  const wasExploring = useRef(false);
  useEffect(() => {
    if (!tourState) {
      cancelResumeSlide();
      prevMode.current = null;
      wasExploring.current = false;
      return;
    }
    if (tourState.exploring) {
      cancelResumeSlide();
      wasExploring.current = true;
      return;
    }
    const opened = prevMode.current === null;
    const modeChanged = !opened && prevMode.current !== tourState.mode;
    const resumed = wasExploring.current;
    prevMode.current = tourState.mode;
    wasExploring.current = false;

    if (modeChanged) {
      goToSlide(0);
    } else if (opened || resumed) {
      const { openOn, slideTo } = tourResumeMotion(tourState, reduceMotion);
      placeSlide(openOn, false);
      if (slideTo !== null) {
        cancelResumeSlide();
        resumeTimer.current = setTimeout(() => {
          resumeTimer.current = null;
          // A swipe or tap during the fade has already moved the card on.
          if (activeIndex.value === openOn) goToSlide(slideTo);
        }, ENTER_FADE_MS);
      }
    }
  }, [tourState, reduceMotion, activeIndex, placeSlide, goToSlide, cancelResumeSlide]);

  const handleNext = useCallback(() => {
    const next = activeIndex.value + 1;
    if (next < slideCount) {
      goToSlide(next);
    } else {
      dismiss();
    }
  }, [activeIndex, slideCount, goToSlide, dismiss]);

  const handleShowMe = useCallback(() => {
    const current = activeIndex.value;
    const slide = slides[current];
    const route = slide ? resolveShowMeRoute(slide, library) : undefined;
    if (!slide || route === undefined) return;

    const nextIndex = Math.min(current + 1, slideCount - 1);
    showMe(current, nextIndex, slide.showMeTip);
    navigateTab(route);
  }, [activeIndex, slides, slideCount, showMe, library]);

  const handlePagerAction = useCallback(
    (event: AccessibilityActionEvent) => {
      const current = activeIndex.value;
      if (event.nativeEvent.actionName === 'increment' && current < slideCount - 1) {
        goToSlide(current + 1);
      } else if (event.nativeEvent.actionName === 'decrement' && current > 0) {
        goToSlide(current - 1);
      }
    },
    [activeIndex, slideCount, goToSlide]
  );

  const handleModeToggle = useCallback(() => {
    const newMode = tourState?.mode === 'tutorial' ? 'whatsNew' : 'tutorial';
    startTour(newMode);
  }, [tourState?.mode, startTour]);

  const settleOnJS = useGestureCallback(setCurrentIndex);
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-10, 10])
        .failOffsetY([-10, 10])
        .onUpdate((event) => {
          'worklet';
          const currentOffset = tourPageOffset(activeIndex.value, contentWidth);
          let newX = currentOffset + event.translationX;
          const maxOffset = tourPageOffset(slideCount - 1, contentWidth);
          newX = Math.max(maxOffset, Math.min(0, newX));
          translateX.value = newX;
        })
        .onEnd((event) => {
          'worklet';
          const velocity = event.velocityX;
          const currentOffset = tourPageOffset(activeIndex.value, contentWidth);
          const distance = translateX.value - currentOffset;

          let targetIndex = activeIndex.value;
          if (Math.abs(distance) > swipeThreshold || Math.abs(velocity) > VELOCITY_THRESHOLD) {
            if (distance < 0 && velocity <= 0) {
              targetIndex = Math.min(slideCount - 1, activeIndex.value + 1);
            } else if (distance > 0 && velocity >= 0) {
              targetIndex = Math.max(0, activeIndex.value - 1);
            }
          }

          activeIndex.value = targetIndex;
          translateX.value = withTiming(tourPageOffset(targetIndex, contentWidth), TIMING_CONFIG);
          runOnJS(settleOnJS)(targetIndex);
        }),
    [translateX, activeIndex, slideCount, contentWidth, swipeThreshold, settleOnJS]
  );

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const position = t('whatsNew.slidePosition', { n: currentIndex + 1, total: slideCount });
  // Modal is visible when tour is active and user is NOT exploring
  const showModal = tourState !== null && !tourState.exploring;
  useAnnounceOnAppear(showModal ? position : null);
  if (slideCount === 0) return null;

  const bgColor = isDark ? darkColors.surface : colors.surface;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const primaryColor = isDark ? darkColors.actionPrimary : colors.actionPrimary;

  const canToggleMode = missedSlides.length > 0;

  // A modal is its own window: it draws over the tab bar, takes Android back through
  // `onRequestClose`, and hides the app beneath from TalkBack. iOS keeps the app
  // beneath a transparent modal, so the card marks itself modal for VoiceOver.
  return (
    <FullWindowModal
      visible={showModal}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={dismiss}
    >
      <GestureHandlerRootView
        style={styles.overlay}
        onLayout={(event: LayoutChangeEvent) => setOverlayHeight(event.nativeEvent.layout.height)}
      >
        {/* press-feedback: none, the scrim is the way out and not a control */}
        <Pressable
          focusable={false}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
          style={styles.backdrop}
          onPress={dismiss}
        />
        <View
          testID="whats-new-card"
          accessibilityViewIsModal
          style={[styles.card, { width: contentWidth, backgroundColor: bgColor }]}
        >
          <GestureDetector gesture={panGesture}>
            <View style={[styles.slideArea, { maxHeight: slideAreaHeight }]}>
              <Animated.View
                testID="whats-new-slide-row"
                style={[styles.slideRow, { width: contentWidth * slideCount }, contentStyle]}
              >
                {slides.map((slide, index) => (
                  <View key={index} {...pageAccessibility(index, currentIndex)}>
                    <WhatsNewSlide
                      icon={slide.icon}
                      title={t(slide.titleKey as never)}
                      body={t(slide.bodyKey as never)}
                      availableHeight={slideAreaHeight}
                    >
                      <slide.Component />
                    </WhatsNewSlide>
                  </View>
                ))}
              </Animated.View>
            </View>
          </GestureDetector>

          <View
            onLayout={(event: LayoutChangeEvent) =>
              setChromeHeight(event.nativeEvent.layout.height)
            }
          >
            {tourState?.mode === 'tutorial' ? <TourSyncLine /> : null}
            {/* Mode toggle + dot indicators */}
            <View style={styles.indicators}>
              {canToggleMode ? (
                <Button
                  label={
                    tourState?.mode === 'tutorial'
                      ? t('whatsNew.justWhatsNew')
                      : t('whatsNew.seeAllFeatures')
                  }
                  onPress={handleModeToggle}
                  variant="secondary"
                  size="sm"
                />
              ) : null}
              <View
                style={styles.dots}
                accessible
                accessibilityRole="adjustable"
                accessibilityValue={{
                  min: 1,
                  max: slideCount,
                  now: currentIndex + 1,
                  text: position,
                }}
                accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
                onAccessibilityAction={handlePagerAction}
                accessibilityLiveRegion="polite"
              >
                {slides.map((_, index) => (
                  <DotIndicator
                    key={index}
                    index={index}
                    activeIndex={activeIndex}
                    primaryColor={primaryColor}
                    mutedColor={mutedColor}
                  />
                ))}
              </View>
            </View>

            {/* Navigation buttons: Skip | Show Me | Next/Done */}
            <NavigationButtons
              index={currentIndex}
              slides={slides}
              slideCount={slideCount}
              onSkip={dismiss}
              onNext={handleNext}
              onShowMe={handleShowMe}
              skipLabel={t('whatsNew.skipButton')}
              nextLabel={t('whatsNew.nextButton')}
              doneLabel={t('whatsNew.doneButton')}
              showMeLabel={t('whatsNew.showMeButton')}
            />
          </View>
        </View>
      </GestureHandlerRootView>
    </FullWindowModal>
  );
}

function DotIndicator({
  index,
  activeIndex,
  primaryColor,
  mutedColor,
}: {
  index: number;
  activeIndex: SharedValue<number>;
  primaryColor: string;
  mutedColor: string;
}) {
  const dotStyle = useAnimatedStyle(() => ({
    backgroundColor: activeIndex.value === index ? primaryColor : mutedColor,
    width: activeIndex.value === index ? 8 : 6,
    height: activeIndex.value === index ? 8 : 6,
  }));

  return <Animated.View style={[styles.dot, dotStyle]} />;
}

// A button that does not apply to the slide in view is not rendered, so it is never
// pressed or focused unseen. When Skip, Show Me and Next do not fit side by side at
// their natural widths, Show Me takes a full-width row above the other two.
function NavigationButtons({
  index,
  slides,
  slideCount,
  onSkip,
  onNext,
  onShowMe,
  skipLabel,
  nextLabel,
  doneLabel,
  showMeLabel,
}: {
  index: number;
  slides: { showMeRoute?: string }[];
  slideCount: number;
  onSkip: () => void;
  onNext: () => void;
  onShowMe: () => void;
  skipLabel: string;
  nextLabel: string;
  doneLabel: string;
  showMeLabel: string;
}) {
  const isLast = index === slideCount - 1;
  const canShowMe = !!slides[index]?.showMeRoute;
  const { fontScale } = useWindowDimensions();

  const [rowWidth, setRowWidth] = useState(0);
  const [skipWidth, setSkipWidth] = useState(0);
  const [nextWidth, setNextWidth] = useState(0);
  // Stacked, Show Me is stretched to the row, so its natural width is the one last
  // measured in a row, for as long as its label and the text size are unchanged.
  const showMeKey = `${showMeLabel}|${fontScale}`;
  const [showMeMeasure, setShowMeMeasure] = useState({ key: '', width: 0 });
  const showMeWidth = showMeMeasure.key === showMeKey ? showMeMeasure.width : 0;

  const stacked =
    canShowMe &&
    tourFooterLayout(rowWidth, { skip: skipWidth, showMe: showMeWidth, next: nextWidth }) ===
      'stacked';

  const skipSlot = (
    <View
      testID="whats-new-skip-slot"
      style={styles.navLeft}
      onLayout={(event: LayoutChangeEvent) => setSkipWidth(event.nativeEvent.layout.width)}
    >
      {!isLast && (
        <Button
          testID="whats-new-skip"
          label={skipLabel}
          onPress={onSkip}
          variant="ghost"
          size="sm"
        />
      )}
    </View>
  );

  const nextSlot = (
    <View
      testID="whats-new-next-slot"
      style={styles.navRight}
      onLayout={(event: LayoutChangeEvent) => setNextWidth(event.nativeEvent.layout.width)}
    >
      {isLast ? (
        <Button testID="whats-new-done" label={doneLabel} onPress={onSkip} size="sm" />
      ) : (
        <Button
          testID="whats-new-next"
          label={nextLabel}
          onPress={onNext}
          variant="ghost"
          size="sm"
        />
      )}
    </View>
  );

  const showMeSlot = canShowMe && (
    <View
      testID="whats-new-show-me-slot"
      style={stacked ? undefined : styles.navSlot}
      onLayout={(event: LayoutChangeEvent) => {
        if (!stacked) setShowMeMeasure({ key: showMeKey, width: event.nativeEvent.layout.width });
      }}
    >
      <Button
        testID="whats-new-show-me"
        label={showMeLabel}
        onPress={onShowMe}
        variant="ghost"
        size="sm"
        icon="arrow-right"
      />
    </View>
  );

  return (
    <View
      testID="whats-new-footer"
      style={styles.nav}
      onLayout={(event: LayoutChangeEvent) =>
        setRowWidth(Math.max(0, event.nativeEvent.layout.width - NAV_HORIZONTAL_PADDING * 2))
      }
    >
      {stacked ? <View testID="whats-new-show-me-row">{showMeSlot}</View> : null}
      <View testID="whats-new-nav-row" style={styles.navRow}>
        {skipSlot}
        {!stacked && showMeSlot}
        {nextSlot}
      </View>
    </View>
  );
}

const NAV_HORIZONTAL_PADDING = spacing.lg;

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colorWithOpacity(ink.black, 0.6),
  },
  card: {
    borderRadius: layout.borderRadius,
    overflow: 'hidden',
    maxHeight: `${TOUR_CARD_HEIGHT_RATIO * 100}%`,
  },
  slideArea: {
    overflow: 'hidden',
  },
  slideRow: {
    flexDirection: 'row',
  },
  indicators: {
    alignItems: 'center',
    paddingTop: spacing.sm,
    gap: spacing.xs,
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  dot: {
    borderRadius: layout.borderRadiusXs,
  },
  nav: {
    paddingHorizontal: NAV_HORIZONTAL_PADDING,
    paddingBottom: spacing.lg,
    gap: TOUR_FOOTER_GAP,
  },
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: TOUR_FOOTER_GAP,
  },
  // Each button keeps its natural width in the row, so what is measured is never a
  // squeezed width.
  navSlot: {
    flexShrink: 0,
  },
  navLeft: {
    flexShrink: 0,
    minWidth: 60,
    alignItems: 'flex-start',
  },
  navRight: {
    flexShrink: 0,
    minWidth: 80,
    alignItems: 'flex-end',
  },
});
