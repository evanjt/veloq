import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  Pressable,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';
import { Text } from 'react-native-paper';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  FadeIn,
  FadeOut,
  useReducedMotion,
  type SharedValue,
} from 'react-native-reanimated';
import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { navigateTab } from '@/shared/app/navigation';
import { useTheme } from '@/shared/app';
import { colors, darkColors, spacing, layout, ink, colorWithOpacity } from '@/theme';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { useCutoverSummary, useGroupSummaries, useSectionSummaries } from '@/features/routes';
import { cutoverHasChangesToShow } from '@/features/settings/lib/cutoverShowMe';
import { resolveShowMeRoute, SHOW_ME_MIN_VISITS } from '@/features/settings/lib/tourShowMe';
import { TOUR_CARD_HEIGHT_RATIO, tourSlideAreaHeight } from '../../lib/tourSlideFit';
import { tourResumeMotion } from '../../lib/tourResume';
import { getAllSlides, getSlidesSince, type WhatsNewSlideDefinition } from './slides';
import { WhatsNewSlide } from './WhatsNewSlide';
import { Button, pressable, pressRipple } from '@/shared/ui';

const SWIPE_THRESHOLD_RATIO = 0.2;
const VELOCITY_THRESHOLD = 400;
const TIMING_CONFIG = { duration: 250, easing: Easing.out(Easing.cubic) };
const ENTER_FADE_MS = 300;

const MODAL_HORIZONTAL_PADDING = spacing.xl;
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
  const contentWidth = windowWidth - MODAL_HORIZONTAL_PADDING * 2;
  const swipeThreshold = windowWidth * SWIPE_THRESHOLD_RATIO;
  const reduceMotion = useReducedMotion();
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

  const currentVersion = Constants.expoConfig?.version ?? '';
  const allSlides = ALL_SLIDES;
  const missedSlides = lastSeenVersion ? getSlidesSince(lastSeenVersion) : [];

  const hasAutoTriggered = useRef(false);
  useEffect(() => {
    // Demo is not a sign-in: opening the tour there would mark it seen before the first real one.
    if (!isLoaded || !isAuthenticated || isDemoMode || hasAutoTriggered.current || tourState)
      return;
    if (lastSeenVersion === null && allSlides.length > 0) {
      hasAutoTriggered.current = true;
      startTour('tutorial');
    } else if (lastSeenVersion !== currentVersion && missedSlides.length > 0) {
      hasAutoTriggered.current = true;
      startTour('whatsNew');
    } else if (lastSeenVersion !== currentVersion) {
      hasAutoTriggered.current = true;
      markSeen(currentVersion);
    }
  }, [
    isLoaded,
    isAuthenticated,
    isDemoMode,
    lastSeenVersion,
    currentVersion,
    missedSlides.length,
    allSlides.length,
    tourState,
    startTour,
    markSeen,
  ]);

  const tourSlides =
    tourState?.mode === 'tutorial' ? allSlides : missedSlides.length > 0 ? missedSlides : allSlides;
  const slides = useMemo(
    () =>
      tourSlides.map(
        (slide): WhatsNewSlideDefinition =>
          slide.showMeWhen === 'cutoverChanged' && !cutoverChanged ? withoutShowMe(slide) : slide
      ),
    [tourSlides, cutoverChanged]
  );
  const slideCount = slides.length;

  const translateX = useSharedValue(0);
  const activeIndex = useSharedValue(0);

  const dismiss = useCallback(() => {
    dismissTour(currentVersion);
  }, [currentVersion, dismissTour]);

  const goToSlide = useCallback(
    (index: number) => {
      activeIndex.value = index;
      translateX.value = withTiming(-contentWidth * index, TIMING_CONFIG);
    },
    [translateX, activeIndex, contentWidth]
  );

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
      activeIndex.value = openOn;
      translateX.value = -contentWidth * openOn;
      if (slideTo !== null) {
        cancelResumeSlide();
        resumeTimer.current = setTimeout(() => {
          resumeTimer.current = null;
          // A swipe or tap during the fade has already moved the card on.
          if (activeIndex.value === openOn) goToSlide(slideTo);
        }, ENTER_FADE_MS);
      }
    }
  }, [
    tourState,
    reduceMotion,
    translateX,
    activeIndex,
    contentWidth,
    goToSlide,
    cancelResumeSlide,
  ]);

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
    if (!slide?.showMeRoute) return;

    const route =
      resolveShowMeRoute(slide, { sectionId: busiestSectionId, routeId: busiestRouteId }) ??
      slide.showMeRoute;
    const nextIndex = Math.min(current + 1, slideCount - 1);
    showMe(current, nextIndex, slide.showMeTip);
    navigateTab(route);
  }, [activeIndex, slides, slideCount, showMe, busiestSectionId, busiestRouteId]);

  const handleModeToggle = useCallback(() => {
    const newMode = tourState?.mode === 'tutorial' ? 'whatsNew' : 'tutorial';
    startTour(newMode);
  }, [tourState?.mode, startTour]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-10, 10])
        .onUpdate((event) => {
          'worklet';
          const currentOffset = -contentWidth * activeIndex.value;
          let newX = currentOffset + event.translationX;
          const maxOffset = -contentWidth * (slideCount - 1);
          newX = Math.max(maxOffset, Math.min(0, newX));
          translateX.value = newX;
        })
        .onEnd((event) => {
          'worklet';
          const velocity = event.velocityX;
          const currentOffset = -contentWidth * activeIndex.value;
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
          translateX.value = withTiming(-contentWidth * targetIndex, TIMING_CONFIG);
        }),
    [translateX, activeIndex, slideCount, contentWidth, swipeThreshold]
  );

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  // Modal is visible when tour is active and user is NOT exploring
  const showModal = tourState !== null && !tourState.exploring;
  if (!showModal || slideCount === 0) return null;

  const bgColor = isDark ? darkColors.surface : colors.surface;
  const mutedColor = isDark ? darkColors.textSecondary : colors.textSecondary;
  const primaryColor = isDark ? darkColors.primary : colors.primary;

  const canToggleMode = missedSlides.length > 0 && allSlides.length > missedSlides.length;

  return (
    <Animated.View
      style={styles.overlay}
      entering={FadeIn.duration(ENTER_FADE_MS)}
      exiting={FadeOut.duration(200)}
      onLayout={(event: LayoutChangeEvent) => setOverlayHeight(event.nativeEvent.layout.height)}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.close')}
        style={pressable(styles.backdrop)}
        android_ripple={pressRipple}
        onPress={dismiss}
      />
      <View style={[styles.card, { width: contentWidth, backgroundColor: bgColor }]}>
        <GestureDetector gesture={panGesture}>
          <View style={[styles.slideArea, { maxHeight: slideAreaHeight }]}>
            <Animated.View
              style={[styles.slideRow, { width: contentWidth * slideCount }, contentStyle]}
            >
              {slides.map((slide, index) => (
                <WhatsNewSlide
                  key={index}
                  icon={slide.icon}
                  title={t(slide.titleKey as never)}
                  body={t(slide.bodyKey as never)}
                  availableHeight={slideAreaHeight}
                >
                  <slide.Component />
                </WhatsNewSlide>
              ))}
            </Animated.View>
          </View>
        </GestureDetector>

        <View
          onLayout={(event: LayoutChangeEvent) => setChromeHeight(event.nativeEvent.layout.height)}
        >
          {/* Mode toggle + dot indicators */}
          <View style={styles.indicators}>
            {canToggleMode && (
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
            )}
            <View style={styles.dots}>
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
            activeIndex={activeIndex}
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
    </Animated.View>
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

function NavigationButtons({
  activeIndex,
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
  activeIndex: SharedValue<number>;
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
  const isLast = useAnimatedStyle(() => ({
    opacity: activeIndex.value === slideCount - 1 ? 0 : 1,
  }));

  const doneStyle = useAnimatedStyle(() => ({
    opacity: activeIndex.value === slideCount - 1 ? 1 : 0,
  }));

  // Show Me is visible when the current slide has a showMeRoute
  const showMeStyle = useAnimatedStyle(() => ({
    opacity: slides[activeIndex.value]?.showMeRoute ? 1 : 0,
  }));

  return (
    <View style={styles.nav}>
      {/* Left: Skip (hidden on last slide) */}
      <View style={styles.navLeft}>
        <Animated.View style={isLast}>
          <Button label={skipLabel} onPress={onSkip} variant="ghost" size="sm" />
        </Animated.View>
      </View>

      {/* Center: Show Me */}
      <Animated.View style={showMeStyle}>
        <Button
          label={showMeLabel}
          onPress={onShowMe}
          variant="ghost"
          size="sm"
          icon={<Text>→</Text>}
        />
      </Animated.View>

      {/* Right: Next / Done */}
      <View style={styles.navRight}>
        <Animated.View style={doneStyle}>
          <Button label={doneLabel} onPress={onSkip} size="sm" />
        </Animated.View>
        <Animated.View style={[styles.nextOverlay, isLast]}>
          <Button label={nextLabel} onPress={onNext} variant="ghost" size="sm" />
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  navLeft: {
    minWidth: 60,
    alignItems: 'flex-start',
  },
  navRight: {
    position: 'relative',
    minWidth: 80,
    alignItems: 'flex-end',
  },
  nextOverlay: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
});
