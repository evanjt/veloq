import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { View, StyleSheet, Dimensions, Pressable } from 'react-native';
import { Text } from 'react-native-paper';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  runOnJS,
  Easing,
  FadeIn,
  FadeOut,
  type SharedValue,
} from 'react-native-reanimated';
import Constants from 'expo-constants';
import { useTranslation } from 'react-i18next';
import { navigateTab } from '@/lib';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing, layout } from '@/theme';
import { useWhatsNewStore, useMapPreferences, useAuthStore } from '@/providers';
import { WHATS_NEW_SLIDES, getAllSlides } from './slides';
import { WhatsNewSlide } from './WhatsNewSlide';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.2;
const VELOCITY_THRESHOLD = 400;
const TIMING_CONFIG = { duration: 250, easing: Easing.out(Easing.cubic) };

const MODAL_HORIZONTAL_PADDING = spacing.xl;
const CONTENT_WIDTH = SCREEN_WIDTH - MODAL_HORIZONTAL_PADDING * 2;
const ALL_SLIDES = getAllSlides();

export function WhatsNewModal() {
  const { t } = useTranslation();
  const { isDark } = useTheme();
  const isLoaded = useWhatsNewStore((s) => s.isLoaded);
  const lastSeenVersion = useWhatsNewStore((s) => s.lastSeenVersion);
  const tourState = useWhatsNewStore((s) => s.tourState);
  const markSeen = useWhatsNewStore((s) => s.markSeen);
  const startTour = useWhatsNewStore((s) => s.startTour);
  const showMe = useWhatsNewStore((s) => s.showMe);
  const endTour = useWhatsNewStore((s) => s.endTour);
  const { setDefaultStyle, setTerrain3DMode } = useMapPreferences();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const currentVersion = Constants.expoConfig?.version ?? '';
  const versionSlides = WHATS_NEW_SLIDES[currentVersion] ?? [];
  const allSlides = ALL_SLIDES;
  const isAutoTriggered = lastSeenVersion !== currentVersion;

  // Auto-trigger tour after login:
  // - First-time user (lastSeenVersion is null): full tutorial with all slides
  // - Upgrading user (lastSeenVersion differs): what's new for current version only
  const hasAutoTriggered = useRef(false);
  useEffect(() => {
    if (!isLoaded || !isAuthenticated || hasAutoTriggered.current || tourState) return;
    if (lastSeenVersion === null && allSlides.length > 0) {
      hasAutoTriggered.current = true;
      startTour('tutorial');
    } else if (lastSeenVersion !== currentVersion && versionSlides.length > 0) {
      hasAutoTriggered.current = true;
      startTour('whatsNew');
    }
  }, [
    isLoaded,
    isAuthenticated,
    lastSeenVersion,
    currentVersion,
    versionSlides.length,
    allSlides.length,
    tourState,
    startTour,
  ]);

  const slides =
    tourState?.mode === 'tutorial'
      ? allSlides
      : versionSlides.length > 0
        ? versionSlides
        : allSlides;
  const slideCount = slides.length;

  const translateX = useSharedValue(0);
  const activeIndex = useSharedValue(0);

  // Reset carousel position when tourState changes (resume or mode switch)
  const prevResumeIndex = useRef<number | null>(null);
  const prevMode = useRef<string | null>(null);
  useEffect(() => {
    if (!tourState || tourState.exploring) return;
    const modeChanged = prevMode.current !== null && prevMode.current !== tourState.mode;
    const resumeChanged =
      prevResumeIndex.current !== null && prevResumeIndex.current !== tourState.resumeIndex;
    if (modeChanged || resumeChanged) {
      const idx = modeChanged ? 0 : tourState.resumeIndex;
      activeIndex.value = idx;
      translateX.value = withTiming(-CONTENT_WIDTH * idx, TIMING_CONFIG);
    }
    prevResumeIndex.current = tourState.resumeIndex;
    prevMode.current = tourState.mode;
  }, [tourState, translateX, activeIndex]);

  const dismiss = useCallback(() => {
    if (isAutoTriggered && WHATS_NEW_SLIDES[currentVersion]) {
      markSeen(currentVersion);
    }
    endTour();
  }, [isAutoTriggered, currentVersion, markSeen, endTour]);

  const goToSlide = useCallback(
    (index: number) => {
      activeIndex.value = index;
      translateX.value = withTiming(-CONTENT_WIDTH * index, TIMING_CONFIG);
    },
    [translateX, activeIndex]
  );

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

    // Execute pre-navigation actions
    if (slide.showMeAction === 'enableSatellite3D') {
      setDefaultStyle('satellite');
      setTerrain3DMode(null, 'smart');
    }

    const nextIndex = Math.min(current + 1, slideCount - 1);
    showMe(nextIndex, slide.showMeTip);
    navigateTab(slide.showMeRoute);
  }, [activeIndex, slides, slideCount, showMe, setDefaultStyle, setTerrain3DMode]);

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
          const currentOffset = -CONTENT_WIDTH * activeIndex.value;
          let newX = currentOffset + event.translationX;
          const maxOffset = -CONTENT_WIDTH * (slideCount - 1);
          newX = Math.max(maxOffset, Math.min(0, newX));
          translateX.value = newX;
        })
        .onEnd((event) => {
          'worklet';
          const velocity = event.velocityX;
          const currentOffset = -CONTENT_WIDTH * activeIndex.value;
          const distance = translateX.value - currentOffset;

          let targetIndex = activeIndex.value;
          if (Math.abs(distance) > SWIPE_THRESHOLD || Math.abs(velocity) > VELOCITY_THRESHOLD) {
            if (distance < 0 && velocity <= 0) {
              targetIndex = Math.min(slideCount - 1, activeIndex.value + 1);
            } else if (distance > 0 && velocity >= 0) {
              targetIndex = Math.max(0, activeIndex.value - 1);
            }
          }

          activeIndex.value = targetIndex;
          translateX.value = withTiming(-CONTENT_WIDTH * targetIndex, TIMING_CONFIG);
        }),
    [translateX, activeIndex, slideCount]
  );

  const contentStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  // Modal is visible when tour is active and user is NOT exploring
  const showModal = tourState !== null && !tourState.exploring;
  if (!showModal || slideCount === 0) return null;

  const bgColor = isDark ? darkColors.surface : colors.surface;
  const textColor = isDark ? darkColors.textPrimary : colors.textPrimary;
  const mutedColor = isDark ? darkColors.textMuted : colors.textMuted;
  const primaryColor = isDark ? darkColors.primary : colors.primary;

  // Show mode toggle when both version slides and historical slides exist
  const canToggleMode = versionSlides.length > 0 && allSlides.length > versionSlides.length;

  return (
    <Animated.View
      style={styles.overlay}
      entering={FadeIn.duration(300)}
      exiting={FadeOut.duration(200)}
    >
      <Pressable style={styles.backdrop} onPress={dismiss} />
      <View style={[styles.card, { backgroundColor: bgColor }]}>
        <GestureDetector gesture={panGesture}>
          <View style={styles.slideArea}>
            <Animated.View
              style={[styles.slideRow, { width: CONTENT_WIDTH * slideCount }, contentStyle]}
            >
              {slides.map((slide, index) => (
                <WhatsNewSlide
                  key={index}
                  icon={slide.icon}
                  title={t(slide.titleKey as never)}
                  body={t(slide.bodyKey as never)}
                >
                  <slide.Component />
                </WhatsNewSlide>
              ))}
            </Animated.View>
          </View>
        </GestureDetector>

        {/* Mode toggle + dot indicators */}
        <View style={styles.indicators}>
          {canToggleMode && (
            <Pressable
              onPress={handleModeToggle}
              hitSlop={8}
              style={[styles.modeTogglePill, { borderColor: primaryColor }]}
            >
              <Text style={[styles.modeToggleText, { color: primaryColor }]}>
                {tourState?.mode === 'tutorial'
                  ? t('whatsNew.justWhatsNew')
                  : t('whatsNew.seeAllFeatures')}
              </Text>
            </Pressable>
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
          textColor={textColor}
          mutedColor={mutedColor}
          primaryColor={primaryColor}
          skipLabel={t('whatsNew.skipButton')}
          nextLabel={t('whatsNew.nextButton')}
          doneLabel={t('whatsNew.doneButton')}
          showMeLabel={t('whatsNew.showMeButton')}
        />
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
  textColor,
  mutedColor,
  primaryColor,
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
  textColor: string;
  mutedColor: string;
  primaryColor: string;
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
          <Pressable onPress={onSkip} hitSlop={12}>
            <Text style={[styles.navText, { color: mutedColor }]}>{skipLabel}</Text>
          </Pressable>
        </Animated.View>
      </View>

      {/* Center: Show Me */}
      <Animated.View style={showMeStyle}>
        <Pressable onPress={onShowMe} hitSlop={12}>
          <Text style={[styles.navText, styles.navTextBold, { color: primaryColor }]}>
            {showMeLabel} →
          </Text>
        </Pressable>
      </Animated.View>

      {/* Right: Next / Done */}
      <View style={styles.navRight}>
        <Animated.View style={doneStyle}>
          <Pressable
            onPress={onSkip}
            hitSlop={12}
            style={[styles.doneButton, { backgroundColor: primaryColor }]}
          >
            <Text style={[styles.doneText, { color: '#FFFFFF' }]}>{doneLabel}</Text>
          </Pressable>
        </Animated.View>
        <Animated.View style={[styles.nextOverlay, isLast]}>
          <Pressable onPress={onNext} hitSlop={12}>
            <Text style={[styles.navText, styles.navTextBold, { color: primaryColor }]}>
              {nextLabel}
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  card: {
    width: SCREEN_WIDTH - MODAL_HORIZONTAL_PADDING * 2,
    borderRadius: layout.borderRadius,
    overflow: 'hidden',
    maxHeight: '80%',
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
  modeTogglePill: {
    borderWidth: 1.5,
    borderRadius: layout.borderRadiusLg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  modeToggleText: {
    fontSize: 14,
    fontWeight: '600',
  },
  dots: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  dot: {
    borderRadius: 4,
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
  navText: {
    fontSize: 16,
    fontWeight: '500',
  },
  navTextBold: {
    fontWeight: '600',
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
  doneButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: layout.borderRadiusSm,
  },
  doneText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
