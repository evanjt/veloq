/**
 * Unified performance chart for route and section detail pages.
 *
 * Shows speed/pace over time with collapsible swim lanes for forward/reverse
 * directions. Each lane shows traversal count and can be collapsed.
 */

import React, { useState, useMemo, useCallback, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  LayoutAnimation,
  Platform,
  UIManager,
  Dimensions,
  ScrollView,
} from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { router, Href } from 'expo-router';
import { CartesianChart, Line } from 'victory-native';
import { Circle } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedScrollHandler,
  scrollTo,
  runOnJS,
} from 'react-native-reanimated';
import {
  formatPace,
  formatSpeed,
  formatDuration,
  isRunningActivity,
  getActivityColor,
  formatShortDate as formatShortDateLib,
} from '@/lib';
import { colors, darkColors } from '@/theme';
import type { ActivityType, RoutePoint, PerformanceDataPoint } from '@/types';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const CHART_PADDING_LEFT = 40;
const CHART_PADDING_RIGHT = 20;
const MIN_POINT_SPACING = 50; // Minimum pixels between points
const BASE_CHART_WIDTH = SCREEN_WIDTH - 32; // Default chart width

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const LANE_HEIGHT = 80;

/** Format date with 2-digit year (e.g., "Jan 15 '24") */
function formatShortDate(date: Date): string {
  const base = formatShortDateLib(date);
  const year = date.getFullYear().toString().slice(-2);
  return `${base} '${year}`;
}

/** Format date for axis labels - includes year as 2-digit suffix */
function formatAxisDate(date: Date): string {
  const month = date.toLocaleDateString(undefined, { month: 'short' });
  const year = date.getFullYear().toString().slice(-2);
  return `${month} '${year}`;
}

/** Summary statistics to display in the chart header */
export interface ChartSummaryStats {
  bestTime: number | null;
  avgTime: number | null;
  totalActivities: number;
  lastActivity: Date | null;
  currentTime?: number | null;
  bestDate?: Date | null;
}

/** Per-direction best record for display in lane header */
export interface DirectionBestRecord {
  bestTime: number;
  bestSpeed?: number; // Speed (m/s) for routes where distance varies
  activityDate: Date;
}

/** Per-direction summary stats for lane header display */
export interface DirectionSummaryStats {
  /** Average time across all traversals in this direction */
  avgTime: number | null;
  /** Average speed across all traversals (for routes where distance varies) */
  avgSpeed?: number | null;
  /** Date of most recent traversal in this direction */
  lastActivity: Date | null;
  /** Number of traversals in this direction */
  count: number;
}

export interface UnifiedPerformanceChartProps {
  chartData: (PerformanceDataPoint & { x: number })[];
  activityType: ActivityType;
  isDark: boolean;
  minSpeed: number;
  maxSpeed: number;
  bestIndex: number;
  hasReverseRuns: boolean;
  tooltipBadgeType: 'match' | 'time';
  onActivitySelect?: (activityId: string | null, activityPoints?: RoutePoint[]) => void;
  /** Called when scrubbing state changes - useful for deferring expensive updates during scrub */
  onScrubChange?: (isScrubbing: boolean) => void;
  selectedActivityId?: string | null;
  summaryStats?: ChartSummaryStats;
  currentIndex?: number;
  variant?: 'route' | 'activity';
  embedded?: boolean;
  /** Best record in forward/same direction (for lane header PR display) */
  bestForwardRecord?: DirectionBestRecord | null;
  /** Best record in reverse direction (for lane header PR display) */
  bestReverseRecord?: DirectionBestRecord | null;
  /** Summary stats for forward direction (avgTime, lastActivity, count) */
  forwardStats?: DirectionSummaryStats | null;
  /** Summary stats for reverse direction (avgTime, lastActivity, count) */
  reverseStats?: DirectionSummaryStats | null;
}

interface LaneData {
  points: (PerformanceDataPoint & { x: number })[];
  originalIndices: number[];
  bestIndex: number;
  currentIndex: number;
  minSpeed: number;
  maxSpeed: number;
}

export function UnifiedPerformanceChart({
  chartData,
  activityType,
  isDark,
  bestIndex,
  hasReverseRuns,
  tooltipBadgeType,
  onActivitySelect,
  onScrubChange,
  summaryStats,
  currentIndex,
  variant = 'route',
  embedded = false,
  bestForwardRecord,
  bestReverseRecord,
  forwardStats,
  reverseStats,
}: UnifiedPerformanceChartProps) {
  const { t } = useTranslation();
  const showPace = isRunningActivity(activityType);
  const activityColor = getActivityColor(activityType);

  // Get section distance from chart data for pace calculations
  const sectionDistance = chartData[0]?.sectionDistance || 0;

  // Track selected point for tooltip
  const [selectedPoint, setSelectedPoint] = useState<(PerformanceDataPoint & { x: number }) | null>(
    null
  );
  const [isScrubbing, setIsScrubbing] = useState(false);

  // Gesture tracking for scrubbing
  const touchX = useSharedValue(-1);
  const scrollOffsetX = useSharedValue(0); // Track scroll position for accurate scrub positioning
  const forwardScrollRef = useAnimatedRef<Animated.ScrollView>();
  const reverseScrollRef = useAnimatedRef<Animated.ScrollView>();
  const timeAxisScrollRef = useAnimatedRef<Animated.ScrollView>();
  const lastNotifiedIdx = useRef<number>(-1);
  const activeScroller = useSharedValue<number>(0); // 0=none, 1=forward, 2=reverse, 3=timeAxis

  // All scroll handlers run on UI thread - no JS bridge
  const handleForwardScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      'worklet';
      const offsetX = event.contentOffset.x;
      scrollOffsetX.value = offsetX;
      if (activeScroller.value === 0 || activeScroller.value === 1) {
        activeScroller.value = 1;
        scrollTo(reverseScrollRef, offsetX, 0, false);
        scrollTo(timeAxisScrollRef, offsetX, 0, false);
      }
    },
    onEndDrag: () => {
      'worklet';
      activeScroller.value = 0;
    },
    onMomentumEnd: () => {
      'worklet';
      activeScroller.value = 0;
    },
  });

  const handleReverseScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      'worklet';
      const offsetX = event.contentOffset.x;
      scrollOffsetX.value = offsetX;
      if (activeScroller.value === 0 || activeScroller.value === 2) {
        activeScroller.value = 2;
        scrollTo(forwardScrollRef, offsetX, 0, false);
        scrollTo(timeAxisScrollRef, offsetX, 0, false);
      }
    },
    onEndDrag: () => {
      'worklet';
      activeScroller.value = 0;
    },
    onMomentumEnd: () => {
      'worklet';
      activeScroller.value = 0;
    },
  });

  const handleTimeAxisScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      'worklet';
      const offsetX = event.contentOffset.x;
      if (activeScroller.value === 0 || activeScroller.value === 3) {
        activeScroller.value = 3;
        scrollTo(forwardScrollRef, offsetX, 0, false);
        scrollTo(reverseScrollRef, offsetX, 0, false);
      }
    },
    onEndDrag: () => {
      'worklet';
      activeScroller.value = 0;
    },
    onMomentumEnd: () => {
      'worklet';
      activeScroller.value = 0;
    },
  });

  // Lane expansion state
  const [forwardExpanded, setForwardExpanded] = useState(true);
  const [reverseExpanded, setReverseExpanded] = useState(true);

  // Gap compression settings
  const GAP_THRESHOLD_DAYS = 14; // Gaps larger than this get compressed
  const COMPRESSED_GAP_DAYS = 5; // Visual width of compressed gap

  // State for individually expanded gaps (by index)
  const [expandedGaps, setExpandedGaps] = useState<Set<number>>(new Set());

  // Detect gaps in data globally (must be before chartWidth calculation)
  const detectedGaps = useMemo(() => {
    if (chartData.length < 2) return [];

    const sortedDates = [...chartData].sort((a, b) => a.date.getTime() - b.date.getTime());
    const GAP_THRESHOLD_MS = GAP_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;

    const gaps: {
      beforeIdx: number;
      afterIdx: number;
      gapDays: number;
      startDate: Date;
      endDate: Date;
    }[] = [];

    for (let i = 1; i < sortedDates.length; i++) {
      const prevTime = sortedDates[i - 1].date.getTime();
      const currTime = sortedDates[i].date.getTime();
      const gapMs = currTime - prevTime;

      if (gapMs > GAP_THRESHOLD_MS) {
        gaps.push({
          beforeIdx: i - 1,
          afterIdx: i,
          gapDays: Math.round(gapMs / (24 * 60 * 60 * 1000)),
          startDate: sortedDates[i - 1].date,
          endDate: sortedDates[i].date,
        });
      }
    }

    return gaps;
  }, [chartData]);

  // Toggle individual gap expansion
  const toggleGap = useCallback((gapIndex: number) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedGaps((prev) => {
      const next = new Set(prev);
      if (next.has(gapIndex)) {
        next.delete(gapIndex);
      } else {
        next.add(gapIndex);
      }
      return next;
    });
  }, []);

  // Calculate dynamic chart width based on number of points and expanded gaps
  const chartWidth = useMemo(() => {
    const minWidth = BASE_CHART_WIDTH;
    let pointsWidth =
      chartData.length * MIN_POINT_SPACING + CHART_PADDING_LEFT + CHART_PADDING_RIGHT;

    // Add extra width for each expanded gap
    if (detectedGaps.length > 0 && expandedGaps.size > 0) {
      const totalExpandedGapDays = detectedGaps
        .filter((_, idx) => expandedGaps.has(idx))
        .reduce((sum, gap) => sum + gap.gapDays - COMPRESSED_GAP_DAYS, 0); // Extra days beyond compressed
      pointsWidth += totalExpandedGapDays * 2; // ~2 pixels per extra day
    }

    return Math.max(minWidth, pointsWidth);
  }, [chartData.length, detectedGaps, expandedGaps]);

  const chartContentWidth = chartWidth - CHART_PADDING_LEFT - CHART_PADDING_RIGHT;
  const isScrollable = chartWidth > BASE_CHART_WIDTH;

  // Calculate X positions with gap compression
  interface GapWithPosition {
    xPosition: number; // Center position
    startX: number; // Left edge position
    endX: number; // Right edge position
    gapDays: number;
    gapIndex: number;
    isExpanded: boolean;
  }

  const { dateToX, gaps, timeAxisLabels } = useMemo(() => {
    if (chartData.length === 0) {
      return {
        dateToX: () => 0.5,
        gaps: [] as GapWithPosition[],
        timeAxisLabels: [] as { date: Date; position: number }[],
      };
    }

    const sortedDates = [...chartData].sort((a, b) => a.date.getTime() - b.date.getTime());
    const firstTime = sortedDates[0].date.getTime();
    const lastTime = sortedDates[sortedDates.length - 1].date.getTime();
    const totalRange = lastTime - firstTime || 1;

    // If no gaps detected, use linear scale
    if (detectedGaps.length === 0) {
      const convertDateToX = (date: Date): number => {
        const t = date.getTime();
        return 0.05 + ((t - firstTime) / totalRange) * 0.9;
      };

      // Generate monthly labels
      const labels: { date: Date; position: number }[] = [];
      const firstDate = sortedDates[0].date;
      const lastDate = sortedDates[sortedDates.length - 1].date;

      const currentMonth = new Date(firstDate.getFullYear(), firstDate.getMonth(), 1);
      while (currentMonth <= lastDate) {
        if (currentMonth >= firstDate || currentMonth.getMonth() === firstDate.getMonth()) {
          labels.push({
            date: new Date(currentMonth),
            position: convertDateToX(currentMonth),
          });
        }
        currentMonth.setMonth(currentMonth.getMonth() + 1);
      }

      // Filter out labels that are too close together
      // Need at least ~70px between labels to avoid overlap (labels are ~50px wide)
      const chartContentW = BASE_CHART_WIDTH - CHART_PADDING_LEFT - CHART_PADDING_RIGHT;
      const minSpacing = 70 / chartContentW; // Convert pixels to normalized position
      const uniqueLabels = labels
        .sort((a, b) => a.position - b.position)
        .filter(
          (label, idx, arr) =>
            idx === 0 || Math.abs(label.position - arr[idx - 1].position) >= minSpacing
        );

      return {
        dateToX: convertDateToX,
        gaps: [] as GapWithPosition[],
        timeAxisLabels: uniqueLabels,
      };
    }

    // Build time mapping with gap compression
    const COMPRESSED_GAP_MS = COMPRESSED_GAP_DAYS * 24 * 60 * 60 * 1000;
    const GAP_THRESHOLD_MS = GAP_THRESHOLD_DAYS * 24 * 60 * 60 * 1000;
    const timeMapping: { originalTime: number; compressedTime: number }[] = [];
    let compressedTime = 0;
    let gapCounter = 0; // Track which gap we're at

    for (let i = 0; i < sortedDates.length; i++) {
      const currTime = sortedDates[i].date.getTime();

      if (i === 0) {
        timeMapping.push({ originalTime: currTime, compressedTime: 0 });
      } else {
        const prevTime = sortedDates[i - 1].date.getTime();
        const gapMs = currTime - prevTime;

        // Check if this is a large gap (>30 days)
        const isLargeGap = gapMs > GAP_THRESHOLD_MS;

        if (isLargeGap) {
          // Check if user expanded this specific gap
          const userExpandedThisGap = expandedGaps.has(gapCounter);

          if (userExpandedThisGap) {
            // User clicked to expand - show full gap
            compressedTime += gapMs;
          } else {
            // Default: compress this gap
            compressedTime += COMPRESSED_GAP_MS;
          }
          gapCounter++; // Move to next gap
        } else {
          // Not a large gap - show actual time
          compressedTime += gapMs;
        }
        timeMapping.push({ originalTime: currTime, compressedTime });
      }
    }

    const totalCompressedRange = compressedTime || 1;

    const convertDateToX = (date: Date): number => {
      const t = date.getTime();
      // Find the mapping for this time
      for (let j = 0; j < timeMapping.length; j++) {
        if (timeMapping[j].originalTime === t) {
          return 0.05 + (timeMapping[j].compressedTime / totalCompressedRange) * 0.9;
        }
      }
      // Interpolate for times not in mapping
      for (let j = 1; j < timeMapping.length; j++) {
        if (t < timeMapping[j].originalTime) {
          const prevMap = timeMapping[j - 1];
          const nextMap = timeMapping[j];
          const ratio = (t - prevMap.originalTime) / (nextMap.originalTime - prevMap.originalTime);
          const interpCompressed =
            prevMap.compressedTime + ratio * (nextMap.compressedTime - prevMap.compressedTime);
          return 0.05 + (interpCompressed / totalCompressedRange) * 0.9;
        }
      }
      return 0.5;
    };

    // Calculate gap positions for indicators
    const gapsWithPositions: GapWithPosition[] = detectedGaps.map((gap, idx) => {
      const beforeX = convertDateToX(gap.startDate);
      const afterX = convertDateToX(gap.endDate);
      return {
        xPosition: (beforeX + afterX) / 2,
        startX: beforeX,
        endX: afterX,
        gapDays: gap.gapDays,
        gapIndex: idx,
        isExpanded: expandedGaps.has(idx),
      };
    });

    // Generate time axis labels - data points, gap boundaries, and monthly markers
    const labels: { date: Date; position: number }[] = [];

    const firstDate = sortedDates[0].date;
    const lastDate = sortedDates[sortedDates.length - 1].date;

    // Add labels at actual data points (most important!)
    sortedDates.forEach(({ date }) => {
      labels.push({ date, position: convertDateToX(date) });
    });

    // Add labels at gap boundaries for context
    gapsWithPositions.forEach((gap, idx) => {
      const gapInfo = detectedGaps[idx];
      if (gapInfo) {
        labels.push({ date: gapInfo.startDate, position: convertDateToX(gapInfo.startDate) });
        labels.push({ date: gapInfo.endDate, position: convertDateToX(gapInfo.endDate) });
      }
    });

    // Add monthly markers if range > 3 months
    const monthsInRange =
      (lastDate.getFullYear() - firstDate.getFullYear()) * 12 +
      (lastDate.getMonth() - firstDate.getMonth());
    if (monthsInRange > 3) {
      const currentMonth = new Date(firstDate.getFullYear(), firstDate.getMonth() + 1, 1);
      while (currentMonth <= lastDate) {
        labels.push({ date: new Date(currentMonth), position: convertDateToX(currentMonth) });
        currentMonth.setMonth(currentMonth.getMonth() + 1);
      }
    }

    // Remove duplicates and sort by position
    // Reduce spacing to 50px to show more labels
    const chartContentW = chartWidth - CHART_PADDING_LEFT - CHART_PADDING_RIGHT;
    const minSpacing = 50 / chartContentW;
    const uniqueLabels = labels
      .sort((a, b) => a.position - b.position)
      .filter(
        (label, idx, arr) =>
          idx === 0 || Math.abs(label.position - arr[idx - 1].position) >= minSpacing
      );

    return { dateToX: convertDateToX, gaps: gapsWithPositions, timeAxisLabels: uniqueLabels };
  }, [chartData, detectedGaps, expandedGaps]);

  // Split data by direction, using date-based X positioning
  const { forwardLane, reverseLane } = useMemo(() => {
    const forwardPoints: (PerformanceDataPoint & { x: number })[] = [];
    const reversePoints: (PerformanceDataPoint & { x: number })[] = [];
    const forwardIndices: number[] = [];
    const reverseIndices: number[] = [];

    chartData.forEach((point, idx) => {
      const x = dateToX(point.date);
      if (point.direction === 'reverse') {
        reversePoints.push({ ...point, x });
        reverseIndices.push(idx);
      } else {
        forwardPoints.push({ ...point, x });
        forwardIndices.push(idx);
      }
    });

    const calculateLaneStats = (
      points: (PerformanceDataPoint & { x: number })[],
      indices: number[]
    ): LaneData => {
      if (points.length === 0) {
        return {
          points: [],
          originalIndices: [],
          bestIndex: -1,
          currentIndex: -1,
          minSpeed: 0,
          maxSpeed: 1,
        };
      }

      // Find best (fastest) within THIS lane
      let laneBestIdx = -1;
      let laneBestSpeed = -Infinity;
      let current = -1;
      let min = Infinity;
      let max = -Infinity;

      points.forEach((p, idx) => {
        if (currentIndex !== undefined && indices[idx] === currentIndex) current = idx;
        min = Math.min(min, p.speed);
        max = Math.max(max, p.speed);
        // Track fastest in this lane
        if (p.speed > laneBestSpeed) {
          laneBestSpeed = p.speed;
          laneBestIdx = idx;
        }
      });

      const padding = (max - min) * 0.2 || 0.5;
      return {
        points,
        originalIndices: indices,
        bestIndex: laneBestIdx,
        currentIndex: current,
        minSpeed: min - padding,
        maxSpeed: max + padding,
      };
    };

    return {
      forwardLane: calculateLaneStats(forwardPoints, forwardIndices),
      reverseLane: calculateLaneStats(reversePoints, reverseIndices),
    };
  }, [chartData, currentIndex, dateToX]);

  const hasForward = forwardLane.points.length > 0;
  const hasReverse = reverseLane.points.length > 0;
  // Always show swim lanes - provides consistent UI and shows direction context
  const showSwimLanes = true;

  const formatSpeedValue = useCallback(
    (speed: number) => (showPace ? formatPace(speed) : formatSpeed(speed)),
    [showPace]
  );

  const toggleForward = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setForwardExpanded((prev) => !prev);
  }, []);

  const toggleReverse = useCallback(() => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setReverseExpanded((prev) => !prev);
  }, []);

  const handlePointPress = useCallback(
    (point: PerformanceDataPoint & { x: number }) => {
      setSelectedPoint(point);
      if (onActivitySelect) {
        onActivitySelect(point.activityId, point.lapPoints);
      }
    },
    [onActivitySelect]
  );

  const clearSelection = useCallback(() => {
    setSelectedPoint(null);
    setIsScrubbing(false);
    if (onActivitySelect) {
      onActivitySelect(null, undefined);
    }
  }, [onActivitySelect]);

  // Update selection based on touch X position (for scrubbing)
  // Takes the touch X relative to the visible area and the current scroll offset
  // Searches ALL data points across both lanes - user wants cross-lane scrubbing
  const updateSelectionFromTouch = useCallback(
    (x: number, scrollOffset: number) => {
      if (chartData.length === 0) return;

      // Account for scroll offset: touch position + scroll offset = position in chart content
      const chartX = x + scrollOffset - CHART_PADDING_LEFT;
      const normalizedX = Math.max(0, Math.min(1, chartX / chartContentWidth));

      // Find the closest data point across ALL lanes by comparing normalized X positions
      let closestIdx = 0;
      let closestDist = Infinity;
      chartData.forEach((point, idx) => {
        const pointX = dateToX(point.date);
        const dist = Math.abs(pointX - normalizedX);
        if (dist < closestDist) {
          closestDist = dist;
          closestIdx = idx;
        }
      });

      // Only notify if index changed
      if (closestIdx !== lastNotifiedIdx.current) {
        lastNotifiedIdx.current = closestIdx;
        const point = chartData[closestIdx];
        if (point) {
          setSelectedPoint(point);
          if (onActivitySelect) {
            onActivitySelect(point.activityId, point.lapPoints);
          }
        }
      }
    },
    [chartData, chartContentWidth, dateToX, onActivitySelect]
  );

  // Animated reaction to update selection when touchX changes
  // Only react to touchX changes, read scrollOffset inside callback
  useAnimatedReaction(
    () => touchX.value,
    (x) => {
      if (x >= 0) {
        runOnJS(updateSelectionFromTouch)(x, scrollOffsetX.value);
      }
    },
    [updateSelectionFromTouch]
  );

  // Callbacks for gesture state changes
  const onGestureStart = useCallback(() => {
    onScrubChange?.(true);
  }, [onScrubChange]);

  const onGestureEnd = useCallback(() => {
    onScrubChange?.(false);
  }, [onScrubChange]);

  // Pan gesture for scrubbing
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(150) // 150ms long press to activate
        .onStart((e) => {
          'worklet';
          touchX.value = e.x;
          runOnJS(onGestureStart)();
          runOnJS(setIsScrubbing)(true);
        })
        .onUpdate((e) => {
          'worklet';
          touchX.value = e.x;
        })
        .onEnd(() => {
          'worklet';
          touchX.value = -1;
          runOnJS(onGestureEnd)();
          runOnJS(setIsScrubbing)(false);
        }),
    [touchX, onGestureStart, onGestureEnd]
  );

  // Tap gesture to clear selection
  // Use maxDuration and maxDistance to prevent interfering with scroll momentum
  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(200) // Only register quick taps
        .onEnd(() => {
          'worklet';
          runOnJS(clearSelection)();
        }),
    [clearSelection]
  );

  // Combined gesture - use Native() to allow ScrollView to handle scroll momentum properly
  const nativeGesture = useMemo(() => Gesture.Native(), []);
  const composedGesture = useMemo(
    () => Gesture.Simultaneous(nativeGesture, Gesture.Simultaneous(tapGesture, panGesture)),
    [nativeGesture, tapGesture, panGesture]
  );

  // Crosshair animation - accounts for scroll offset so crosshair appears at touch position
  const crosshairStyle = useAnimatedStyle(() => {
    if (touchX.value < 0) {
      return { opacity: 0, transform: [{ translateX: 0 }] };
    }
    // Add scroll offset: touch position is relative to visible viewport,
    // but crosshair is inside scrollable content, so we need to offset
    return {
      opacity: 1,
      transform: [{ translateX: touchX.value + scrollOffsetX.value }],
    };
  }, []);

  // Time span display - use calendar days for accurate day counting
  const timeRangeDisplay = useMemo(() => {
    if (chartData.length < 2) return null;
    const firstDate = chartData[0].date;
    const lastDate = chartData[chartData.length - 1].date;
    // Compare calendar days, not elapsed milliseconds
    const firstDay = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate());
    const lastDay = new Date(lastDate.getFullYear(), lastDate.getMonth(), lastDate.getDate());
    const daysDiff = Math.round((lastDay.getTime() - firstDay.getTime()) / (1000 * 60 * 60 * 24));
    if (daysDiff < 7) return null;
    if (daysDiff < 60) return { value: `${daysDiff}`, label: t('time.days') };
    if (daysDiff < 365) return { value: `${Math.round(daysDiff / 30)}`, label: t('time.months') };
    return { value: `${Math.round((daysDiff / 365) * 10) / 10}`, label: t('time.years') };
  }, [chartData, t]);

  if (chartData.length < 1) return null;

  const renderLaneChart = useCallback(
    (lane: LaneData, color: string, direction: 'forward' | 'reverse') => {
      if (lane.points.length === 0) return null;

      // Find selected point index in this lane
      const selectedLaneIdx = selectedPoint
        ? lane.points.findIndex((p) => p.activityId === selectedPoint.activityId)
        : -1;

      return (
        <View style={styles.laneChart}>
          <View style={StyleSheet.absoluteFill}>
            <CartesianChart
              data={lane.points as unknown as Record<string, unknown>[]}
              xKey={'x' as never}
              yKeys={['speed'] as never}
              domain={{
                x: [0, 1], // Normalized date range (0-1)
                y: [lane.minSpeed, lane.maxSpeed],
              }}
              padding={{ left: 40, right: 20, top: 16, bottom: 12 }}
            >
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              {
                (({ points }: any) => (
                  <>
                    {/* No connecting lines - dots are positioned by date */}
                    {/* Data points */}
                    {points.speed.map((point: any, idx: number) => {
                      if (point.x == null || point.y == null) return null;
                      const isBest = idx === lane.bestIndex;
                      const isCurrent = idx === lane.currentIndex;
                      const isSelected = idx === selectedLaneIdx;

                      // Selected point (cyan ring like PR gold ring)
                      if (isSelected) {
                        return (
                          <React.Fragment key={`point-${idx}`}>
                            <Circle cx={point.x} cy={point.y} r={8} color={colors.chartCyan} />
                            <Circle cx={point.x} cy={point.y} r={5} color={color} />
                          </React.Fragment>
                        );
                      }

                      // Best point (gold ring with colored center)
                      if (isBest && !isCurrent) {
                        return (
                          <React.Fragment key={`point-${idx}`}>
                            <Circle cx={point.x} cy={point.y} r={8} color={colors.chartGold} />
                            <Circle cx={point.x} cy={point.y} r={5} color={color} />
                          </React.Fragment>
                        );
                      }

                      // Current point (cyan ring with colored center)
                      if (isCurrent) {
                        return (
                          <React.Fragment key={`point-${idx}`}>
                            <Circle cx={point.x} cy={point.y} r={9} color={colors.chartCyan} />
                            <Circle cx={point.x} cy={point.y} r={5} color={color} />
                          </React.Fragment>
                        );
                      }

                      // Regular point
                      return (
                        <Circle
                          key={`point-${idx}`}
                          cx={point.x}
                          cy={point.y}
                          r={5}
                          color={color}
                        />
                      );
                    })}
                  </>
                )) as any
              }
            </CartesianChart>
          </View>

          {/* Tap targets for each point */}
          <View style={styles.tapTargetContainer} pointerEvents="box-none">
            {lane.points.map((point, idx) => {
              // Use the point's normalized X position (0-1 range based on date)
              const xPercent = point.x;
              return (
                <Pressable
                  key={`tap-${idx}`}
                  style={[
                    styles.tapTarget,
                    {
                      left: `${xPercent * 100}%`,
                      transform: [{ translateX: -20 }],
                    },
                  ]}
                  onPress={() => handlePointPress(point)}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                />
              );
            })}
          </View>

          {/* Y-axis labels */}
          <View style={styles.yAxisOverlay} pointerEvents="none">
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
              {formatSpeedValue(lane.maxSpeed)}
            </Text>
            <Text style={[styles.axisLabel, isDark && styles.axisLabelDark]}>
              {formatSpeedValue(lane.minSpeed)}
            </Text>
          </View>

          {/* Gap indicators - show edges and fill when expanded */}
          {gaps.length > 0 && (
            <View style={styles.gapLinesOverlay} pointerEvents="none">
              {gaps.map((gap, idx) => {
                const chartContentW = chartWidth - CHART_PADDING_LEFT - CHART_PADDING_RIGHT;
                const startPixelX = CHART_PADDING_LEFT + gap.startX * chartContentW;
                const endPixelX = CHART_PADDING_LEFT + gap.endX * chartContentW;
                const gapWidth = endPixelX - startPixelX;

                if (gap.isExpanded) {
                  // Expanded: show two edge lines (label is in time axis below)
                  const lineColor = isDark ? '#666666' : '#999999';

                  return (
                    <View key={`gap-expanded-${idx}`}>
                      {/* Left edge line */}
                      <View
                        style={[
                          styles.gapEdgeLine,
                          { left: startPixelX, backgroundColor: lineColor },
                        ]}
                      />
                      {/* Right edge line */}
                      <View
                        style={[
                          styles.gapEdgeLine,
                          { left: endPixelX, backgroundColor: lineColor },
                        ]}
                      />
                    </View>
                  );
                } else {
                  // Compressed: single center line
                  const pixelX = CHART_PADDING_LEFT + gap.xPosition * chartContentW + 4;
                  return (
                    <View
                      key={`gap-line-${idx}`}
                      style={[
                        styles.gapVerticalLine,
                        isDark && styles.gapVerticalLineDark,
                        { left: pixelX },
                      ]}
                    />
                  );
                }
              })}
            </View>
          )}
        </View>
      );
    },
    [handlePointPress, formatSpeedValue, isDark, gaps, chartWidth, selectedPoint]
  );

  // Single direction mode (no swim lanes needed)
  if (!showSwimLanes) {
    const singleLane = hasForward ? forwardLane : reverseLane;
    const laneColor = hasForward ? activityColor : colors.reverseDirection;

    return (
      <View style={[!embedded && styles.container, !embedded && isDark && styles.containerDark]}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={[styles.title, isDark && styles.textLight]}>
            {t('sections.performanceOverTime')}
          </Text>
          <View style={styles.legend}>
            {variant === 'activity' && currentIndex !== undefined && currentIndex >= 0 && (
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: colors.chartCyan }]} />
                <Text style={[styles.legendText, isDark && styles.textMuted]}>
                  {t('sections.current')}
                </Text>
              </View>
            )}
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: colors.chartGold }]} />
              <Text style={[styles.legendText, isDark && styles.textMuted]}>
                {t('sections.best')}
              </Text>
            </View>
          </View>
        </View>

        {/* Summary stats */}
        {summaryStats && summaryStats.totalActivities > 0 && (
          <View style={styles.summaryRow}>
            {variant === 'activity' ? (
              <>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryValue, { color: colors.chartCyan }]}>
                    {summaryStats.currentTime ? formatDuration(summaryStats.currentTime) : '-'}
                  </Text>
                  <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>
                    {t('sections.current')}
                  </Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryValue, { color: colors.chartGold }]}>
                    {summaryStats.bestTime
                      ? showPace && sectionDistance > 0
                        ? formatPace(sectionDistance / summaryStats.bestTime)
                        : formatDuration(summaryStats.bestTime)
                      : '-'}
                  </Text>
                  <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>
                    {showPace ? t('sections.bestPace') : t('sections.best')}
                  </Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                    {summaryStats.bestDate ? formatShortDate(summaryStats.bestDate) : '-'}
                  </Text>
                  <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>
                    {t('routes.bestOn')}
                  </Text>
                </View>
                {timeRangeDisplay && (
                  <View style={styles.summaryItem}>
                    <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                      {timeRangeDisplay.value}
                    </Text>
                    <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>
                      {timeRangeDisplay.label}
                    </Text>
                  </View>
                )}
              </>
            ) : (
              <>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryValue, { color: colors.chartGold }]}>
                    {summaryStats.bestTime
                      ? showPace && sectionDistance > 0
                        ? formatPace(sectionDistance / summaryStats.bestTime)
                        : formatDuration(summaryStats.bestTime)
                      : '-'}
                  </Text>
                  <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>
                    {showPace ? t('sections.bestPace') : t('sections.bestTime')}
                  </Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                    {summaryStats.avgTime
                      ? showPace && sectionDistance > 0
                        ? formatPace(sectionDistance / summaryStats.avgTime)
                        : formatDuration(summaryStats.avgTime)
                      : '-'}
                  </Text>
                  <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>
                    {showPace ? t('sections.averagePace') : t('sections.averageTime')}
                  </Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                    {summaryStats.lastActivity ? formatShortDate(summaryStats.lastActivity) : '-'}
                  </Text>
                  <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>
                    {t('sections.lastActivity')}
                  </Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={[styles.summaryValue, isDark && styles.textLight]}>
                    {summaryStats.totalActivities}
                  </Text>
                  <Text style={[styles.summaryLabel, isDark && styles.textMuted]}>
                    {t('sections.traversals')}
                  </Text>
                </View>
              </>
            )}
          </View>
        )}

        {/* Chart with gesture handling */}
        <GestureDetector gesture={composedGesture}>
          <Animated.View style={{ height: LANE_HEIGHT + 20 }}>
            {renderLaneChart(singleLane, laneColor, hasForward ? 'forward' : 'reverse')}
            {/* Crosshair */}
            <Animated.View
              style={[styles.crosshair, crosshairStyle, isDark && styles.crosshairDark]}
              pointerEvents="none"
            />
          </Animated.View>
        </GestureDetector>

        {/* Time axis with multiple labels */}
        {timeAxisLabels.length > 0 && (
          <View style={styles.timeAxis}>
            {timeAxisLabels.map((label, idx) => (
              <Text
                key={idx}
                style={[
                  styles.axisLabel,
                  isDark && styles.axisLabelDark,
                  styles.timeAxisLabel,
                  idx === 0 && styles.timeAxisLabelFirst,
                  idx === timeAxisLabels.length - 1 && styles.timeAxisLabelLast,
                ]}
              >
                {formatAxisDate(label.date)}
              </Text>
            ))}
          </View>
        )}

        {/* Tooltip */}
        <View style={styles.tooltipContainer}>
          {selectedPoint ? (
            <TouchableOpacity
              style={[styles.selectedTooltip, isDark && styles.selectedTooltipDark]}
              onPress={() => router.push(`/activity/${selectedPoint.activityId}` as Href)}
              activeOpacity={0.7}
            >
              <View style={styles.tooltipLeft}>
                <Text style={[styles.tooltipName, isDark && styles.textLight]} numberOfLines={1}>
                  {selectedPoint.activityName}
                </Text>
                <View style={styles.tooltipMeta}>
                  <Text style={[styles.tooltipDate, isDark && styles.textMuted]}>
                    {formatShortDate(selectedPoint.date)}
                  </Text>
                  {tooltipBadgeType === 'time' && selectedPoint.sectionTime != null && (
                    <Text style={[styles.tooltipDate, isDark && styles.textMuted]}>
                      {' · '}
                      {formatDuration(selectedPoint.sectionTime)}
                    </Text>
                  )}
                </View>
              </View>
              <View style={styles.tooltipRight}>
                <Text style={[styles.tooltipSpeed, { color: laneColor }]}>
                  {formatSpeedValue(selectedPoint.speed)}
                </Text>
                <MaterialCommunityIcons
                  name="chevron-right"
                  size={14}
                  color={isDark ? darkColors.textMuted : colors.border}
                />
              </View>
            </TouchableOpacity>
          ) : (
            <View style={styles.tooltipPlaceholder}>
              <Text style={[styles.chartHint, isDark && styles.textMuted]}>
                {t('sections.scrubHint')}
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  }

  // Swim lanes mode (both directions) - stats are now shown per-lane
  return (
    <View style={[!embedded && styles.container, !embedded && isDark && styles.containerDark]}>
      {/* Forward Lane - hidden if no forward data */}
      {hasForward && (
        <>
          {/* Forward Lane Header (fixed) */}
          <View style={[styles.lane, isDark && styles.laneDark]}>
            <Pressable
              style={[styles.laneHeader, isDark && styles.laneHeaderDark]}
              onPress={toggleForward}
            >
              {/* Left: Direction + count */}
              <View style={styles.laneHeaderLeft}>
                <MaterialCommunityIcons
                  name="arrow-right"
                  size={16}
                  color={activityColor}
                  style={styles.directionIcon}
                />
                <Text style={[styles.laneTitle, isDark && styles.textLight]}>
                  {t('sections.forward')}
                </Text>
                <View style={[styles.countBadge, { backgroundColor: activityColor + '20' }]}>
                  <Text style={[styles.countText, { color: activityColor }]}>
                    {forwardLane.points.length}
                  </Text>
                </View>
              </View>
              {/* Middle: Avg */}
              <View style={styles.laneHeaderMiddle}>
                {forwardStats?.avgTime != null && (
                  <Text style={[styles.headerStatText, isDark && styles.headerStatTextDark]}>
                    {showPace
                      ? sectionDistance > 0
                        ? `${formatPace(sectionDistance / forwardStats.avgTime)} avg`
                        : forwardStats.avgSpeed
                          ? `${formatPace(forwardStats.avgSpeed)} avg`
                          : `${formatDuration(forwardStats.avgTime)} avg`
                      : `${formatDuration(forwardStats.avgTime)} avg`}
                  </Text>
                )}
              </View>
              {/* Right: PR with date below */}
              {bestForwardRecord && (
                <View style={styles.prBadgeStacked}>
                  <View style={styles.prBadgeRow}>
                    <MaterialCommunityIcons name="trophy" size={12} color={colors.chartGold} />
                    <Text style={styles.prBadgeTime}>
                      {showPace
                        ? sectionDistance > 0
                          ? formatPace(sectionDistance / bestForwardRecord.bestTime)
                          : bestForwardRecord.bestSpeed
                            ? formatPace(bestForwardRecord.bestSpeed)
                            : formatDuration(bestForwardRecord.bestTime)
                        : formatDuration(bestForwardRecord.bestTime)}
                    </Text>
                  </View>
                  <Text style={styles.prBadgeDateSmall}>
                    {formatShortDate(bestForwardRecord.activityDate)}
                  </Text>
                </View>
              )}
              <MaterialCommunityIcons
                name={forwardExpanded ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={isDark ? darkColors.textMuted : colors.textMuted}
              />
            </Pressable>
          </View>

          {/* Forward Lane Chart (scrollable with gesture handling) */}
          {forwardExpanded && (
            <>
              <GestureDetector gesture={composedGesture}>
                <Animated.ScrollView
                  ref={forwardScrollRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  scrollEnabled={isScrollable && !isScrubbing}
                  onScroll={handleForwardScroll}
                  scrollEventThrottle={8}
                  decelerationRate={0.999}
                  nestedScrollEnabled={true}
                >
                  <Animated.View style={{ height: LANE_HEIGHT, width: chartWidth }}>
                    {renderLaneChart(forwardLane, activityColor, 'forward')}
                    {/* Crosshair */}
                    <Animated.View
                      style={[styles.crosshair, crosshairStyle, isDark && styles.crosshairDark]}
                      pointerEvents="none"
                    />
                  </Animated.View>
                </Animated.ScrollView>
              </GestureDetector>
            </>
          )}
        </>
      )}

      {/* Reverse Lane - hidden if no reverse data */}
      {hasReverse && (
        <>
          {/* Reverse Lane Header (fixed) */}
          <View style={[styles.lane, isDark && styles.laneDark]}>
            <Pressable
              style={[styles.laneHeader, isDark && styles.laneHeaderDark]}
              onPress={toggleReverse}
            >
              {/* Left: Direction + count */}
              <View style={styles.laneHeaderLeft}>
                <MaterialCommunityIcons
                  name="arrow-left"
                  size={16}
                  color={colors.reverseDirection}
                  style={styles.directionIcon}
                />
                <Text style={[styles.laneTitle, isDark && styles.textLight]}>
                  {t('sections.reverse')}
                </Text>
                <View
                  style={[styles.countBadge, { backgroundColor: colors.reverseDirection + '20' }]}
                >
                  <Text style={[styles.countText, { color: colors.reverseDirection }]}>
                    {reverseLane.points.length}
                  </Text>
                </View>
              </View>
              {/* Middle: Avg */}
              <View style={styles.laneHeaderMiddle}>
                {reverseStats?.avgTime != null && (
                  <Text style={[styles.headerStatText, isDark && styles.headerStatTextDark]}>
                    {showPace
                      ? sectionDistance > 0
                        ? `${formatPace(sectionDistance / reverseStats.avgTime)} avg`
                        : reverseStats.avgSpeed
                          ? `${formatPace(reverseStats.avgSpeed)} avg`
                          : `${formatDuration(reverseStats.avgTime)} avg`
                      : `${formatDuration(reverseStats.avgTime)} avg`}
                  </Text>
                )}
              </View>
              {/* Right: PR with date below */}
              {bestReverseRecord && (
                <View style={styles.prBadgeStacked}>
                  <View style={styles.prBadgeRow}>
                    <MaterialCommunityIcons name="trophy" size={12} color={colors.chartGold} />
                    <Text style={styles.prBadgeTime}>
                      {showPace
                        ? sectionDistance > 0
                          ? formatPace(sectionDistance / bestReverseRecord.bestTime)
                          : bestReverseRecord.bestSpeed
                            ? formatPace(bestReverseRecord.bestSpeed)
                            : formatDuration(bestReverseRecord.bestTime)
                        : formatDuration(bestReverseRecord.bestTime)}
                    </Text>
                  </View>
                  <Text style={styles.prBadgeDateSmall}>
                    {formatShortDate(bestReverseRecord.activityDate)}
                  </Text>
                </View>
              )}
              <MaterialCommunityIcons
                name={reverseExpanded ? 'chevron-up' : 'chevron-down'}
                size={20}
                color={isDark ? darkColors.textMuted : colors.textMuted}
              />
            </Pressable>
          </View>

          {/* Reverse Lane Chart (scrollable with gesture handling, synced with forward) */}
          {reverseExpanded && (
            <>
              <GestureDetector gesture={composedGesture}>
                <Animated.ScrollView
                  ref={reverseScrollRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  scrollEnabled={isScrollable && !isScrubbing}
                  onScroll={handleReverseScroll}
                  scrollEventThrottle={8}
                  decelerationRate={0.999}
                  nestedScrollEnabled={true}
                >
                  <Animated.View style={{ height: LANE_HEIGHT, width: chartWidth }}>
                    {renderLaneChart(reverseLane, colors.reverseDirection, 'reverse')}
                    {/* Crosshair */}
                    <Animated.View
                      style={[styles.crosshair, crosshairStyle, isDark && styles.crosshairDark]}
                      pointerEvents="none"
                    />
                  </Animated.View>
                </Animated.ScrollView>
              </GestureDetector>
            </>
          )}
        </>
      )}

      {/* Time axis - scrolls with charts, two rows: dates on top, gap markers below */}
      <Animated.ScrollView
        ref={timeAxisScrollRef}
        horizontal
        showsHorizontalScrollIndicator={isScrollable}
        scrollEnabled={isScrollable}
        onScroll={handleTimeAxisScroll}
        scrollEventThrottle={8}
        decelerationRate={0.999}
        nestedScrollEnabled={true}
        style={styles.timeAxisScroll}
      >
        <View style={[styles.timeAxisContent, { width: chartWidth }]}>
          {/* Date labels row (top) */}
          {timeAxisLabels.map((label, idx) => {
            const chartContentW = chartWidth - CHART_PADDING_LEFT - CHART_PADDING_RIGHT;
            const leftPos = CHART_PADDING_LEFT + label.position * chartContentW;
            return (
              <Text
                key={`label-${idx}`}
                style={[
                  styles.timeAxisDateLabel,
                  isDark && styles.axisLabelDark,
                  { left: leftPos - 20 },
                ]}
              >
                {formatAxisDate(label.date)}
              </Text>
            );
          })}
          {/* Gap markers row (bottom) - icon above day count */}
          {gaps.map((gap, idx) => {
            const chartContentW = chartWidth - CHART_PADDING_LEFT - CHART_PADDING_RIGHT;

            if (gap.isExpanded) {
              // Expanded: span full width of gap
              const startPixelX = CHART_PADDING_LEFT + gap.startX * chartContentW;
              const endPixelX = CHART_PADDING_LEFT + gap.endX * chartContentW;
              const gapPixelWidth = endPixelX - startPixelX;

              return (
                <Pressable
                  key={`gap-${idx}`}
                  style={[
                    styles.gapMarkerExpanded,
                    isDark && styles.gapMarkerExpandedDark,
                    { left: startPixelX, width: gapPixelWidth },
                  ]}
                  onPress={() => toggleGap(gap.gapIndex)}
                >
                  <MaterialCommunityIcons
                    name="arrow-collapse-horizontal"
                    size={12}
                    color={isDark ? '#aaa' : '#666'}
                  />
                  <Text
                    style={[
                      styles.gapMarkerExpandedText,
                      isDark && styles.gapMarkerExpandedTextDark,
                    ]}
                  >
                    {gap.gapDays}d
                  </Text>
                  <MaterialCommunityIcons
                    name="arrow-collapse-horizontal"
                    size={12}
                    color={isDark ? '#aaa' : '#666'}
                  />
                </Pressable>
              );
            } else {
              // Compressed: centered small marker
              const pixelX = CHART_PADDING_LEFT + gap.xPosition * chartContentW + 4;
              return (
                <Pressable
                  key={`gap-${idx}`}
                  style={[
                    styles.gapMarkerInAxisBottom,
                    isDark && styles.gapMarkerInAxisDark,
                    { left: pixelX - 12 },
                  ]}
                  onPress={() => toggleGap(gap.gapIndex)}
                  hitSlop={{ top: 5, bottom: 5, left: 10, right: 10 }}
                >
                  <MaterialCommunityIcons
                    name="arrow-expand-horizontal"
                    size={10}
                    color={isDark ? darkColors.textMuted : colors.textMuted}
                  />
                  <Text style={[styles.gapMarkerText, isDark && styles.gapMarkerTextDark]}>
                    {gap.gapDays}d
                  </Text>
                </Pressable>
              );
            }
          })}
        </View>
      </Animated.ScrollView>

      {/* Tooltip */}
      <View style={styles.tooltipContainer}>
        {selectedPoint ? (
          <TouchableOpacity
            style={[styles.selectedTooltip, isDark && styles.selectedTooltipDark]}
            onPress={() => router.push(`/activity/${selectedPoint.activityId}` as Href)}
            activeOpacity={0.7}
          >
            <View style={styles.tooltipLeft}>
              <Text style={[styles.tooltipName, isDark && styles.textLight]} numberOfLines={1}>
                {selectedPoint.activityName}
              </Text>
              <View style={styles.tooltipMeta}>
                <Text style={[styles.tooltipDate, isDark && styles.textMuted]}>
                  {formatShortDate(selectedPoint.date)}
                </Text>
                {tooltipBadgeType === 'time' && selectedPoint.sectionTime != null && (
                  <Text style={[styles.tooltipDate, isDark && styles.textMuted]}>
                    {' · '}
                    {formatDuration(selectedPoint.sectionTime)}
                  </Text>
                )}
                {selectedPoint.direction === 'reverse' && (
                  <View style={styles.reverseBadge}>
                    <MaterialCommunityIcons
                      name="swap-horizontal"
                      size={10}
                      color={colors.reverseDirection}
                    />
                  </View>
                )}
              </View>
            </View>
            <View style={styles.tooltipRight}>
              <Text
                style={[
                  styles.tooltipSpeed,
                  {
                    color:
                      selectedPoint.direction === 'reverse'
                        ? colors.reverseDirection
                        : activityColor,
                  },
                ]}
              >
                {formatSpeedValue(selectedPoint.speed)}
              </Text>
              <MaterialCommunityIcons
                name="chevron-right"
                size={14}
                color={isDark ? darkColors.textMuted : colors.border}
              />
            </View>
          </TouchableOpacity>
        ) : (
          <View style={styles.tooltipPlaceholder}>
            <Text style={[styles.chartHint, isDark && styles.textMuted]}>
              {t('sections.scrubHint')}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    marginTop: 12,
    overflow: 'hidden',
  },
  containerDark: {
    backgroundColor: darkColors.surfaceCard,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  legend: {
    flexDirection: 'row',
    gap: 8,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  legendDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  legendText: {
    fontSize: 10,
    color: colors.textMuted,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  summaryItem: {
    alignItems: 'center',
    flex: 1,
  },
  summaryValue: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  summaryLabel: {
    fontSize: 10,
    color: colors.textMuted,
    marginTop: 1,
  },
  lane: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  laneDark: {
    borderTopColor: darkColors.border,
  },
  laneHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.background,
  },
  laneHeaderDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  laneHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  laneHeaderMiddle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  headerStatText: {
    fontSize: 11,
    color: colors.textMuted,
  },
  headerStatTextDark: {
    color: darkColors.textMuted,
  },
  headerStatSep: {
    fontSize: 11,
    color: colors.textMuted,
    opacity: 0.5,
  },
  headerStatSepDark: {
    color: darkColors.textMuted,
  },
  prBadgeStacked: {
    alignItems: 'flex-end',
    marginRight: 8,
  },
  prBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  prBadgeDateSmall: {
    fontSize: 9,
    color: colors.chartGold,
    opacity: 0.7,
  },
  directionIcon: {
    marginRight: 2,
  },
  laneTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  countBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    marginLeft: 4,
  },
  countText: {
    fontSize: 11,
    fontWeight: '700',
  },
  // Inline stats in lane headers - responsive pill layout
  inlineStatsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    flexShrink: 1,
    marginRight: 8,
  },
  inlineStatPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  inlineStatPillDark: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
  },
  prPill: {
    backgroundColor: colors.chartGold + '20',
  },
  prStatValue: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.chartGold,
  },
  prStatSeparator: {
    fontSize: 10,
    color: colors.chartGold,
    opacity: 0.6,
  },
  prStatDate: {
    fontSize: 10,
    fontWeight: '500',
    color: colors.chartGold,
    opacity: 0.7,
  },
  statPillLabel: {
    fontSize: 9,
    fontWeight: '500',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  statPillLabelDark: {
    color: 'rgba(255, 255, 255, 0.5)',
  },
  statPillValue: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  statPillValueDark: {
    color: 'rgba(255, 255, 255, 0.9)',
  },
  prBadgeCompact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 'auto',
    marginRight: 8,
  },
  prBadgeTime: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.chartGold,
  },
  statsBar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: colors.surface,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  statsBarDark: {
    backgroundColor: darkColors.surface,
    borderTopColor: darkColors.border,
  },
  statsBarItem: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  statsBarItemDark: {
    color: darkColors.textSecondary,
  },
  statsBarLabel: {
    fontWeight: '500',
    color: colors.textMuted,
  },
  statsBarSeparator: {
    fontSize: 12,
    color: colors.textMuted,
    opacity: 0.5,
  },
  prBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 8,
  },
  prTime: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.chartGold,
  },
  prDate: {
    fontSize: 11,
    color: colors.textMuted,
  },
  laneStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  laneStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  laneStatLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },
  laneStatValue: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textPrimary,
  },
  laneHeaderInScroll: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  laneHeaderContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.background,
  },
  laneChart: {
    flex: 1,
    position: 'relative',
  },
  tapTargetContainer: {
    ...StyleSheet.absoluteFillObject,
    paddingLeft: 40,
    paddingRight: 20,
    flexDirection: 'row',
    alignItems: 'center',
  },
  tapTarget: {
    position: 'absolute',
    width: 40,
    height: '100%',
  },
  yAxisOverlay: {
    position: 'absolute',
    left: 6,
    top: 16,
    bottom: 12,
    justifyContent: 'space-between',
  },
  gapIndicatorsOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  gapIndicator: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    justifyContent: 'center',
    alignItems: 'center',
    width: 24,
  },
  gapLine: {
    flex: 1,
    width: 1,
    backgroundColor: colors.textMuted,
    opacity: 0.25,
  },
  gapLineDark: {
    backgroundColor: darkColors.textMuted,
  },
  gapIcon: {
    opacity: 0.5,
  },
  gapDaysLabel: {
    fontSize: 8,
    color: colors.textMuted,
    opacity: 0.6,
  },
  gapDaysLabelDark: {
    color: darkColors.textMuted,
  },
  timeAxis: {
    height: 32,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    position: 'relative',
  },
  timeAxisScroll: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  timeAxisContent: {
    height: 44,
    position: 'relative',
  },
  timeAxisLabel: {
    position: 'absolute',
    bottom: 8,
    fontSize: 9,
    color: colors.textMuted,
  },
  timeAxisLabelPositioned: {
    position: 'absolute',
    top: 8,
    width: 40,
    fontSize: 9,
    color: colors.textMuted,
    textAlign: 'center',
  },
  timeAxisDateLabel: {
    position: 'absolute',
    top: 4,
    width: 40,
    fontSize: 9,
    color: colors.textMuted,
    textAlign: 'center',
  },
  gapIndicatorInAxis: {
    position: 'absolute',
    top: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 4,
    paddingVertical: 2,
    backgroundColor: colors.surface,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  gapMarkerInAxis: {
    position: 'absolute',
    top: 4,
    width: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 4,
    paddingVertical: 2,
    backgroundColor: colors.surface,
    borderRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  gapMarkerInAxisDark: {
    backgroundColor: darkColors.surfaceElevated,
    borderColor: darkColors.border,
  },
  gapMarkerInAxisBottom: {
    position: 'absolute',
    top: 18,
    width: 24,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 0,
    paddingHorizontal: 2,
    paddingVertical: 2,
    backgroundColor: colors.surface,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    opacity: 0.9,
  },
  gapMarkerExpanded: {
    position: 'absolute',
    top: 18,
    height: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: 4,
    backgroundColor: colors.surface,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.border,
    opacity: 0.9,
  },
  gapMarkerExpandedDark: {
    backgroundColor: darkColors.surfaceElevated,
    borderColor: darkColors.border,
  },
  gapMarkerExpandedText: {
    fontSize: 9,
    fontWeight: '500',
    color: colors.textMuted,
  },
  gapMarkerExpandedTextDark: {
    color: darkColors.textMuted,
  },
  gapLinesOverlay: {
    ...StyleSheet.absoluteFillObject,
    pointerEvents: 'none',
  },
  gapVerticalLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 0,
    borderLeftWidth: 1,
    borderLeftColor: colors.textMuted,
    opacity: 0.4,
  },
  gapVerticalLineDark: {
    borderLeftColor: '#888888',
    opacity: 0.5,
  },
  gapEdgeLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
  },
  gapMarkersOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  gapMarker: {
    position: 'absolute',
    top: 8,
    bottom: 8,
    width: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gapMarkerLine: {
    flex: 1,
    width: 1,
    backgroundColor: colors.border,
    opacity: 0.5,
  },
  gapMarkerLineDark: {
    backgroundColor: darkColors.border,
  },
  gapMarkerLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingHorizontal: 4,
    paddingVertical: 2,
    backgroundColor: colors.surface,
    borderRadius: 4,
  },
  gapMarkerLabelDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  gapMarkerText: {
    fontSize: 8,
    color: colors.textMuted,
  },
  gapMarkerTextDark: {
    color: darkColors.textMuted,
  },
  timeAxisLabelFirst: {
    textAlign: 'left',
  },
  timeAxisLabelLast: {
    textAlign: 'right',
  },
  timeAxisLabelStart: {
    position: 'absolute',
    left: 12,
    bottom: 8,
  },
  timeAxisLabelEnd: {
    position: 'absolute',
    right: 12,
    bottom: 8,
  },
  axisLabel: {
    fontSize: 9,
    color: colors.textMuted,
  },
  axisLabelDark: {
    color: darkColors.textMuted,
  },
  tooltipContainer: {
    minHeight: 52,
    paddingHorizontal: 12,
    paddingBottom: 10,
  },
  tooltipPlaceholder: {
    justifyContent: 'center',
    alignItems: 'center',
    height: 44,
  },
  chartHint: {
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'center',
  },
  selectedTooltip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    padding: 10,
    borderRadius: 8,
  },
  selectedTooltipDark: {
    backgroundColor: darkColors.surfaceElevated,
  },
  tooltipLeft: {
    flex: 1,
    marginRight: 8,
  },
  tooltipName: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 1,
  },
  tooltipMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tooltipDate: {
    fontSize: 11,
    color: colors.textMuted,
  },
  reverseBadge: {
    padding: 1,
  },
  tooltipRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  tooltipSpeed: {
    fontSize: 14,
    fontWeight: '700',
  },
  textLight: {
    color: darkColors.textPrimary,
  },
  textMuted: {
    color: darkColors.textMuted,
  },
  crosshair: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: colors.textPrimary,
    opacity: 0.6,
    marginLeft: -1, // Center the crosshair on the touch point
  },
  crosshairDark: {
    backgroundColor: darkColors.textPrimary,
  },
});
