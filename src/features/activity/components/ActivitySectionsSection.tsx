import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  FlatList,
  Pressable,
  Animated,
  StyleSheet,
  type LayoutChangeEvent,
} from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ChromeIcon } from '@/shared/ui/ChromeIcon';
import type {
  ActivityLedgerChange,
  SectionMatch as FfiSectionMatch,
  SectionEncounter,
} from 'veloqrs';
import type { LatLng } from '@/shared/geo/polyline';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { Gesture, GestureDetector, RectButton } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';
import * as haptics from '@/shared/ui/haptics';
import { useGestureCallback } from '@/shared/ui/useGestureCallback';
import { useTranslation } from 'react-i18next';
import { SectionInlinePlot } from './SectionInlinePlot';
import { ActivityLedgerChanges } from './ActivityLedgerChanges';
import { findRowIndexAtPageY } from './scrubHitTest';
import { DataRangeFooter, removeSectionWithUndo } from '@/features/routes';
import {
  Button,
  Card,
  composeAccessibilityLabel,
  EmptyState,
  pressable,
  pressRipple,
  useBottomClearance,
  type AccessibleAction,
} from '@/shared/ui';
import {
  groupSectionEncounters,
  sectionGroupIndex,
  type SectionEncounterGroup,
} from '@/features/activity/lib/groupSectionEncounters';
import { tapTo } from '@/shared/app/navigation';
import { formatDistance } from '@/shared/format/format';
import {
  colors,
  darkColors,
  duration,
  iconSize,
  shadows,
  spacing,
  swipeAction,
  typography,
} from '@/theme';
import { debug } from '@/shared/debug/debug';
import { PREVIEW_HOLD_MS } from '@/shared/ui/holdDurations';
import { confirmAction, inform } from '@/shared/ui/dialog';

const log = debug.create('ActivitySectionsSection');

interface ActivitySectionsSectionProps {
  activityId: string;
  /** The activity's sport. Lap units follow it, not the section's label. */
  sportType?: string;
  encounters: SectionEncounter[];
  /** Section changes whose ledger rows name this activity */
  ledgerChanges?: readonly ActivityLedgerChange[] | undefined;
  coordinates: LatLng[];
  isDark: boolean;
  isMetric: boolean;
  sectionCreationMode: boolean;
  cacheDays: number;
  highlightedSectionId: string | null;
  onHighlightedSectionIdChange: (id: string | null) => void;
  onSectionCreationModeChange: (mode: boolean) => void;
  removeSection: (sectionId: string) => Promise<void>;
  /** Scan results from useActivityRematch */
  scanMatches: FfiSectionMatch[];
  /** Whether a scan has returned, including one that found nothing */
  hasScanned: boolean;
  /** Trigger a scan for this activity */
  onScan: () => void | Promise<void>;
  /** Force-match to a specific section */
  onRematch: (sectionId: string) => boolean;
  /** A section to bring into view and mark, such as one whose map marker was tapped */
  focusSectionId?: string | null;
  /** Called once the focus has been taken, so the same section can be focused again */
  onFocusHandled?: () => void;
}

const NO_LEDGER_CHANGES: readonly ActivityLedgerChange[] = [];

export const ActivitySectionsSection = React.memo(function ActivitySectionsSection({
  activityId,
  sportType,
  encounters,
  ledgerChanges = NO_LEDGER_CHANGES,
  coordinates,
  isDark,
  isMetric,
  sectionCreationMode,
  cacheDays,
  highlightedSectionId,
  onHighlightedSectionIdChange,
  onSectionCreationModeChange,
  removeSection,
  scanMatches,
  hasScanned: scanReturned,
  onScan,
  onRematch,
  focusSectionId = null,
  onFocusHandled,
}: ActivitySectionsSectionProps) {
  const { t } = useTranslation();
  const bottomClearance = useBottomClearance();

  // Track open swipeable refs to close them when another opens
  const swipeableRefs = useRef<Map<string, Swipeable | null>>(new Map());
  const openSwipeableRef = useRef<string | null>(null);

  // Track which scan matches have been successfully added
  const [addedSectionIds, setAddedSectionIds] = useState(new Set<string>());
  const [scanning, setScanning] = useState(false);
  const scanningRef = useRef(false);

  const handleScan = useCallback(() => {
    if (scanningRef.current) return;
    scanningRef.current = true;
    setScanning(true);
    Promise.resolve()
      .then(onScan)
      .finally(() => {
        scanningRef.current = false;
        setScanning(false);
      });
  }, [onScan]);

  const hasScanned = scanReturned || addedSectionIds.size > 0;

  // Filter scan results: exclude sections already in the encounter list and already added
  const existingSectionIds = useMemo(
    () => new Set(encounters.map((e) => e.sectionId)),
    [encounters]
  );

  // One card per section, however many directions the activity crossed it in.
  const groups = useMemo(() => groupSectionEncounters(encounters), [encounters]);

  const filteredScanMatches = useMemo(
    () =>
      scanMatches.filter(
        (m) => !existingSectionIds.has(m.sectionId) && !addedSectionIds.has(m.sectionId)
      ),
    [scanMatches, existingSectionIds, addedSectionIds]
  );

  const handleRematch = useCallback(
    (sectionId: string) => {
      const success = onRematch(sectionId);
      if (success) {
        setAddedSectionIds((prev) => new Set(prev).add(sectionId));
      }
    },
    [onRematch]
  );

  // Close any open swipeable when another opens
  const handleSwipeableOpen = useCallback((sectionId: string) => {
    if (openSwipeableRef.current && openSwipeableRef.current !== sectionId) {
      const previousSwipeable = swipeableRefs.current.get(openSwipeableRef.current);
      previousSwipeable?.close();
    }
    openSwipeableRef.current = sectionId;
  }, []);

  const handleDisable = useCallback(
    (sectionId: string) => {
      swipeableRefs.current.get(sectionId)?.close();
      removeSectionWithUndo(sectionId, t);
    },
    [t]
  );

  const handleDelete = useCallback(
    (group: SectionEncounterGroup) => {
      confirmAction({
        title: t('sections.deleteSection'),
        message: t('sections.deleteSectionConfirm', { name: group.sectionName }),
        confirmLabel: t('common.delete'),
        cancelLabel: t('common.cancel'),
        destructive: true,
        onConfirm: async () => {
          swipeableRefs.current.get(group.sectionId)?.close();
          try {
            await removeSection(group.sectionId);
          } catch (error) {
            if (__DEV__) console.error('Failed to delete section:', error);
            inform({ title: t('sections.deleteFailedTitle'), message: t('sections.deleteFailed') });
          }
        },
      });
    },
    [removeSection, t]
  );

  // ----- Drag-to-scrub state -----
  // After long-press on a row, pan-drag up/down moves the highlight through rows.
  // FlatList scroll is disabled while scrubbing, and auto-scrolls near the edges.
  //
  // Hit testing is pure arithmetic against row 0's measured pageY and one
  // row-height sample: index = floor((fingerY - firstRowTopY + scrollOffset) / rowHeight).
  // Anchoring on the first row (rather than listTop + paddingTop) removes
  // off-by-one drift caused by parent transforms / safe-area insets / etc.
  const [isScrubbing, setIsScrubbing] = useState(false);
  const isScrubbingRef = useRef(false);
  isScrubbingRef.current = isScrubbing;
  // Shared value mirror of isScrubbing - gesture worklets run on the UI thread
  // where JS refs aren't visible, so we need a SharedValue they can read.
  const isScrubbingSV = useSharedValue(false);

  const flatListRef = useRef<FlatList<SectionEncounterGroup> | null>(null);
  const listContainerRef = useRef<View | null>(null);
  // Window-Y of the list container - only used for the auto-scroll edge
  // detection (am I near the top/bottom of the visible list area?).
  const listTopYRef = useRef(0);
  const listHeightRef = useRef(0);
  const scrollOffsetRef = useRef(0);
  // The anchor point for hit-testing: row 0's window-Y, measured directly
  // at scrub start. Using the first row instead of listTop + paddingTop
  // removes any drift introduced by parent transforms, safe-area padding,
  // or differences between layout-event height and measureInWindow height.
  const firstRowRef = useRef<View | null>(null);
  const firstRowTopYRef = useRef(0);
  // Every card's measured height, in list order. A section crossed both ways
  // renders one row per direction, so cards are not all the same height. The
  // first card's height is kept as a uniform fallback for the frames before
  // every card has reported.
  const rowHeightsRef = useRef<number[]>([]);
  const rowHeightRef = useRef(0);
  const autoScrollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const autoScrollDirectionRef = useRef<0 | 1 | -1>(0);

  const handleRowHeight = useCallback((index: number, height: number) => {
    if (height <= 0) return;
    rowHeightsRef.current[index] = height;
    if (rowHeightRef.current === 0) {
      rowHeightRef.current = height;
    }
  }, []);

  const handleFirstRowRef = useCallback((ref: View | null) => {
    firstRowRef.current = ref;
  }, []);

  // Resolve row 0's current window-Y via measureInWindow. Called at scrub
  // start so any outer-page scroll or layout change since mount is picked up.
  const remeasureFirstRow = useCallback((): Promise<void> => {
    return new Promise((resolve) => {
      const ref = firstRowRef.current;
      if (!ref?.measureInWindow) {
        resolve();
        return;
      }
      ref.measureInWindow((_x: number, y: number) => {
        firstRowTopYRef.current = y;
        resolve();
      });
    });
  }, []);

  const handleListLayout = useCallback((e: LayoutChangeEvent) => {
    listHeightRef.current = e.nativeEvent.layout.height;
  }, []);

  // Map a finger window-Y to a card index by walking the measured card
  // heights. A card is one section, so its id identifies the row to the
  // upstream consumers that key off sectionId - the map among them.
  const nullMatchLoggedRef = useRef(false);
  const findRowAtPageY = useCallback(
    (pageY: number): { sectionId: string } | null => {
      const idx = findRowIndexAtPageY({
        pageY,
        firstRowTopY: firstRowTopYRef.current,
        rowHeight: rowHeightRef.current,
        rowHeights: rowHeightsRef.current,
        scrollOffset: scrollOffsetRef.current,
        rowCount: groups.length,
      });
      if (idx === null) {
        if (!nullMatchLoggedRef.current) {
          nullMatchLoggedRef.current = true;
          log.log('[scrub] no-match pageY=', Math.round(pageY));
        }
        return null;
      }
      return { sectionId: groups[idx].sectionId };
    },
    [groups]
  );

  // Only log when the resolved row actually changes - keeps drag output readable.
  const lastLoggedRowRef = useRef<string | null>(null);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollIntervalRef.current != null) {
      clearInterval(autoScrollIntervalRef.current);
      autoScrollIntervalRef.current = null;
    }
    autoScrollDirectionRef.current = 0;
  }, []);

  // A card is one section, so the section id identifies the row on its own.
  const applyRow = useCallback(
    (row: { sectionId: string } | null) => {
      onHighlightedSectionIdChange(row?.sectionId ?? null);
    },
    [onHighlightedSectionIdChange]
  );

  const ensureAutoScroll = useCallback(
    (direction: 0 | 1 | -1, lastPageY: number) => {
      if (direction === 0) {
        stopAutoScroll();
        return;
      }
      if (autoScrollDirectionRef.current === direction) return;
      stopAutoScroll();
      autoScrollDirectionRef.current = direction;
      autoScrollIntervalRef.current = setInterval(() => {
        const delta = direction * 6; // slow, readable drift
        const next = Math.max(0, scrollOffsetRef.current + delta);
        scrollOffsetRef.current = next;
        flatListRef.current?.scrollToOffset({ offset: next, animated: false });
        const row = findRowAtPageY(lastPageY);
        if (row) applyRow(row);
      }, 16);
    },
    [applyRow, findRowAtPageY, stopAutoScroll]
  );

  const handleScrubMove = useCallback(
    (pageY: number) => {
      const row = findRowAtPageY(pageY);
      const sectionId = row?.sectionId ?? null;
      if (sectionId !== lastLoggedRowRef.current) {
        log.log('[scrub] move → row', sectionId, 'pageY=', Math.round(pageY));
        lastLoggedRowRef.current = sectionId;
      }
      if (row) applyRow(row);
      const relY = pageY - listTopYRef.current;
      const edge = 70;
      if (relY < edge) ensureAutoScroll(-1, pageY);
      else if (relY > listHeightRef.current - edge) ensureAutoScroll(1, pageY);
      else ensureAutoScroll(0, pageY);
    },
    [applyRow, ensureAutoScroll, findRowAtPageY]
  );
  const scrubMoveOnJS = useGestureCallback(handleScrubMove);

  const handleScrubEnd = useCallback(() => {
    log.log('[scrub] end');
    lastLoggedRowRef.current = null;
    nullMatchLoggedRef.current = false;
    stopAutoScroll();
    setIsScrubbing(false);
    isScrubbingSV.value = false;
    applyRow(null);
  }, [applyRow, stopAutoScroll, isScrubbingSV]);
  const scrubEndOnJS = useGestureCallback(handleScrubEnd);

  useEffect(() => () => stopAutoScroll(), [stopAutoScroll]);

  // When the list changes (new activity, re-sort), drop the stale height
  // samples so the next layout pass captures the current values.
  useEffect(() => {
    rowHeightRef.current = 0;
    rowHeightsRef.current = [];
  }, [groups]);

  // ----- Focus from a map marker -----
  // The tapped section's card scrolls to the middle and is marked for the hold
  // duration. The scroll waits a frame, since the tab may mount with the tap,
  // and neither it nor the hold is cancelled when the parent clears the focus.
  const focusFrameRef = useRef<number | null>(null);
  const focusHoldRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const focusRetriesRef = useRef(0);

  const scrollToGroup = useCallback((index: number) => {
    flatListRef.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true });
  }, []);

  useEffect(() => {
    if (!focusSectionId) return;
    const index = sectionGroupIndex(groups, focusSectionId);
    if (index === null) return;
    onHighlightedSectionIdChange(focusSectionId);
    onFocusHandled?.();

    focusRetriesRef.current = 0;
    if (focusFrameRef.current != null) cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = requestAnimationFrame(() => {
      focusFrameRef.current = null;
      scrollToGroup(index);
    });

    if (focusHoldRef.current != null) clearTimeout(focusHoldRef.current);
    focusHoldRef.current = setTimeout(() => {
      focusHoldRef.current = null;
      if (!isScrubbingRef.current) onHighlightedSectionIdChange(null);
    }, duration.hold);
  }, [focusSectionId, groups, onFocusHandled, onHighlightedSectionIdChange, scrollToGroup]);

  useEffect(
    () => () => {
      if (focusFrameRef.current != null) cancelAnimationFrame(focusFrameRef.current);
      if (focusHoldRef.current != null) clearTimeout(focusHoldRef.current);
    },
    []
  );

  // Cards differ in height and only the first few are rendered, so a card
  // further down has no measured offset yet. Jump to its estimated offset,
  // which renders it, then scroll to it on the next frame.
  const handleScrollToIndexFailed = useCallback(
    ({ index, averageItemLength }: { index: number; averageItemLength: number }) => {
      if (focusRetriesRef.current >= 3) return;
      focusRetriesRef.current += 1;
      flatListRef.current?.scrollToOffset({ offset: averageItemLength * index, animated: false });
      focusFrameRef.current = requestAnimationFrame(() => {
        focusFrameRef.current = null;
        scrollToGroup(index);
      });
    },
    [scrollToGroup]
  );

  // Start scrub from a page-Y position (invoked from Pan onStart after activateAfterLongPress).
  const startScrubAt = useCallback(
    (pageY: number) => {
      // Refresh row 0's window-Y once - the outer activity page may have
      // scrolled since mount. Single measureInWindow round-trip, not one per row.
      remeasureFirstRow().then(() => {
        const row = findRowAtPageY(pageY);
        log.log(
          '[scrub] onStart pageY=',
          Math.round(pageY),
          'firstRowTopY=',
          Math.round(firstRowTopYRef.current),
          'rowH=',
          Math.round(rowHeightRef.current),
          'scrollOffset=',
          Math.round(scrollOffsetRef.current),
          'row=',
          row
        );
        if (!row) return;
        haptics.light();
        applyRow(row);
        setIsScrubbing(true);
        isScrubbingSV.value = true;
      });
    },
    [applyRow, findRowAtPageY, isScrubbingSV, remeasureFirstRow]
  );
  const startScrubAtOnJS = useGestureCallback(startScrubAt);

  // Scrub gesture: a Pan that only activates AFTER the user holds their finger
  // still for PREVIEW_HOLD_MS. Once activated, every finger move fires
  // onUpdate continuously, so dragging through rows updates the highlight
  // smoothly. activateAfterLongPress is the canonical RNGH primitive for
  // "press-and-hold, then drag" and coordinates cleanly with nested Swipeables.
  const scrubGesture = useMemo(() => {
    return Gesture.Pan()
      .activateAfterLongPress(PREVIEW_HOLD_MS)
      .onStart((e) => {
        'worklet';
        runOnJS(startScrubAtOnJS)(e.absoluteY);
      })
      .onUpdate((e) => {
        'worklet';
        runOnJS(scrubMoveOnJS)(e.absoluteY);
      })
      .onEnd(() => {
        'worklet';
        runOnJS(scrubEndOnJS)();
      })
      .onFinalize(() => {
        'worklet';
        runOnJS(scrubEndOnJS)();
      });
  }, [startScrubAtOnJS, scrubMoveOnJS, scrubEndOnJS]);

  const handleContainerLayout = useCallback((_e: LayoutChangeEvent) => {
    // Capture the list container's window-Y on mount. Scrub start re-measures
    // only the first row, so an outer-page scroll since this fired leaves it stale.
    listContainerRef.current?.measureInWindow?.((_x: number, y: number) => {
      listTopYRef.current = y;
    });
  }, []);

  // Handle section press navigation
  const handleSectionPress = useCallback(
    (sectionId: string) => {
      tapTo(`/section/${sectionId}?activityId=${activityId}`);
    },
    [activityId]
  );

  // The swipe button and the screen reader's action are one action, so the
  // label and the handler cannot drift apart.
  const sectionAction = useCallback(
    (group: SectionEncounterGroup): AccessibleAction =>
      group.sectionType === 'custom'
        ? { name: 'delete', label: t('common.delete'), run: () => handleDelete(group) }
        : { name: 'hide', label: t('common.hide'), run: () => handleDisable(group.sectionId) },
    [handleDelete, handleDisable, t]
  );
  const sectionActions = useCallback(
    (group: SectionEncounterGroup) => [sectionAction(group)],
    [sectionAction]
  );

  // Render swipe actions for section cards
  const renderSectionSwipeActions = useCallback(
    (
      group: SectionEncounterGroup,
      _progress: Animated.AnimatedInterpolation<number>,
      dragX: Animated.AnimatedInterpolation<number>
    ) => {
      const opacity = dragX.interpolate({
        inputRange: [-80, -40, 0],
        outputRange: [1, 0.8, 0],
        extrapolate: 'clamp',
      });

      const custom = group.sectionType === 'custom';
      const action = sectionAction(group);
      return (
        <Animated.View
          style={[
            styles.swipeAction,
            custom ? styles.deleteSwipeAction : styles.disableSwipeAction,
            { opacity },
          ]}
        >
          <RectButton style={styles.swipeActionButton} onPress={action.run}>
            {custom ? (
              <ChromeIcon name="delete" size={iconSize.lg} color={swipeAction.destructive.text} />
            ) : (
              <MaterialCommunityIcons
                name="eye-off"
                size={iconSize.lg}
                color={swipeAction.hide.text}
              />
            )}
            <Text
              style={[
                styles.swipeActionText,
                custom ? styles.deleteSwipeActionText : styles.disableSwipeActionText,
              ]}
            >
              {action.label}
            </Text>
          </RectButton>
        </Animated.View>
      );
    },
    [sectionAction]
  );

  // FlatList key extractor
  const keyExtractor = useCallback((item: SectionEncounterGroup) => item.sectionId, []);

  // FlatList render item
  const renderEncounterItem = useCallback(
    ({ item, index }: { item: SectionEncounterGroup; index: number }) => {
      return (
        <SectionInlinePlot
          group={item}
          activityId={activityId}
          sportType={sportType}
          index={index}
          isHighlighted={highlightedSectionId === item.sectionId}
          isDark={isDark}
          isMetric={isMetric}
          onPress={handleSectionPress}
          onSwipeableOpen={handleSwipeableOpen}
          onRowHeight={handleRowHeight}
          firstRowRef={handleFirstRowRef}
          renderRightActions={renderSectionSwipeActions}
          actionsFor={sectionActions}
          swipeableRefs={swipeableRefs}
        />
      );
    },
    [
      activityId,
      sportType,
      highlightedSectionId,
      isDark,
      isMetric,
      handleSectionPress,
      handleSwipeableOpen,
      handleRowHeight,
      handleFirstRowRef,
      renderSectionSwipeActions,
      sectionActions,
      swipeableRefs,
    ]
  );

  // Render empty state for section list
  const renderSectionsListEmpty = useCallback(() => {
    return (
      <EmptyState
        variant="compact"
        icon="road-variant"
        title={t('activityDetail.noMatchedSections')}
        description={t('activityDetail.noMatchedSectionsDescription')}
        actionLabel={hasScanned ? undefined : t('sections.scanForMatches')}
        onAction={handleScan}
        actionLoading={scanning}
      />
    );
  }, [t, hasScanned, handleScan, scanning]);

  // Render a single scan match result row. The engine sends the name it
  // resolves for the section, the one every other screen shows.
  const renderScanMatch = useCallback(
    (match: FfiSectionMatch) => {
      const quality = Math.round(match.matchQuality * 100);
      const baseName = match.sectionName || match.sectionId.slice(0, 8);
      const displayName = !match.sameDirection ? `${baseName} \u21A9` : baseName;
      const totalPoints = coordinates?.length ?? 0;
      const startPct = totalPoints > 0 ? Math.round((match.startIndex / totalPoints) * 100) : 0;
      const distance = formatDistance(match.distanceMeters, isMetric);
      const position = startPct > 0 ? t('sections.atPosition', { pct: startPct }) : null;
      const qualityText = quality < 90 ? t('sections.matchQuality', { quality }) : null;
      // The row is one element: the arrow is spoken as the reverse word, then
      // the meta line it draws.
      const spokenName = composeAccessibilityLabel(
        baseName,
        !match.sameDirection && t('sections.reverse'),
        distance,
        position,
        qualityText
      );
      return (
        <View key={`${match.sectionId}-${match.startIndex}`} style={styles.scanMatchFrame}>
          <Card variant="flat" padding="none">
            <View style={styles.scanMatchRow}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={spokenName}
                style={pressable(styles.scanMatchInfo)}
                android_ripple={pressRipple}
                onPress={() => tapTo(`/section/${match.sectionId}?activityId=${activityId}`)}
              >
                <Text
                  numberOfLines={2}
                  style={[styles.scanMatchName, isDark && { color: darkColors.textPrimary }]}
                >
                  {displayName}
                </Text>
                <Text style={[styles.scanMatchMeta, isDark && { color: darkColors.textSecondary }]}>
                  {distance}
                  {position ? ` · ${position}` : ''}
                  {qualityText ? ` · ${qualityText}` : ''}
                </Text>
              </Pressable>
              <Button
                label={t('sections.addToSection')}
                size="sm"
                onPress={() => handleRematch(match.sectionId)}
              />
            </View>
          </Card>
        </View>
      );
    },
    [isDark, isMetric, handleRematch, coordinates, activityId, t]
  );

  // Render footer for section list
  const renderSectionsListFooter = useCallback(() => {
    return (
      <>
        <ActivityLedgerChanges changes={ledgerChanges} isDark={isDark} />

        {/* Scan trigger: show "Scan for more sections" link when sections exist */}
        {encounters.length > 0 && !hasScanned && (
          <Button
            label={t('sections.scanForMore')}
            variant="ghost"
            icon={
              <MaterialCommunityIcons name="magnify" size={iconSize.sm} color={colors.primary} />
            }
            onPress={handleScan}
            loading={scanning}
            style={styles.scanLink}
          />
        )}

        {/* Scan results */}
        {hasScanned && filteredScanMatches.length > 0 ? (
          <View style={styles.scanResultsContainer}>
            <Text style={[styles.scanResultsTitle, isDark && { color: darkColors.textPrimary }]}>
              {t('sections.nearbySectionsCount', { count: filteredScanMatches.length })}
            </Text>
            {filteredScanMatches.map(renderScanMatch)}
          </View>
        ) : null}

        {/* Scan performed but no new results */}
        {hasScanned && filteredScanMatches.length === 0 ? (
          <View style={styles.scanNoResults}>
            <Text style={[styles.scanNoResultsText, isDark && { color: darkColors.textSecondary }]}>
              {t('sections.noMatchesFound')}
            </Text>
          </View>
        ) : null}

        {coordinates.length > 0 && !sectionCreationMode && (
          <Button
            label={t('routes.createSection')}
            icon={
              <MaterialCommunityIcons name="plus" size={iconSize.md} color={colors.textOnPrimary} />
            }
            onPress={() => onSectionCreationModeChange(true)}
            style={styles.createSectionButton}
          />
        )}

        <DataRangeFooter days={cacheDays} isDark={isDark} />
      </>
    );
  }, [
    coordinates.length,
    sectionCreationMode,
    isDark,
    cacheDays,
    t,
    onSectionCreationModeChange,
    encounters.length,
    ledgerChanges,
    hasScanned,
    filteredScanMatches,
    handleScan,
    scanning,
    renderScanMatch,
  ]);

  return (
    <GestureDetector gesture={scrubGesture}>
      <View
        ref={listContainerRef}
        style={styles.tabScrollView}
        onLayout={handleContainerLayout}
        testID="activity-sections-list"
      >
        <FlatList
          ref={flatListRef}
          data={groups}
          keyExtractor={keyExtractor}
          renderItem={renderEncounterItem}
          ListEmptyComponent={renderSectionsListEmpty}
          ListFooterComponent={renderSectionsListFooter}
          contentContainerStyle={[
            groups.length === 0 ? styles.tabScrollContentEmpty : styles.tabScrollContent,
            { paddingBottom: spacing.xl + bottomClearance },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          initialNumToRender={4}
          maxToRenderPerBatch={4}
          windowSize={3}
          removeClippedSubviews
          onLayout={handleListLayout}
          onScroll={(e) => {
            scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
          }}
          scrollEventThrottle={16}
          scrollEnabled={!isScrubbing}
          onScrollToIndexFailed={handleScrollToIndexFailed}
        />
      </View>
    </GestureDetector>
  );
});

const styles = StyleSheet.create({
  tabScrollView: {
    flex: 1,
  },
  tabScrollContent: {
    paddingTop: spacing.md,
  },
  tabScrollContentEmpty: {
    flexGrow: 1,
  },
  createSectionButton: {
    marginHorizontal: spacing.md,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.elevated,
  },
  swipeAction: {
    width: 80,
    justifyContent: 'center',
    alignItems: 'center',
  },
  swipeActionButton: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
  },
  swipeActionText: {
    ...typography.captionBold,
  },
  deleteSwipeAction: {
    backgroundColor: swipeAction.destructive.bg,
  },
  deleteSwipeActionText: {
    color: swipeAction.destructive.text,
  },
  disableSwipeAction: {
    backgroundColor: swipeAction.hide.bg,
  },
  disableSwipeActionText: {
    color: swipeAction.hide.text,
  },
  scanLink: {
    marginHorizontal: spacing.md,
  },
  // Scan results
  scanResultsContainer: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
  },
  scanResultsTitle: {
    fontSize: typography.bodyCompact.fontSize,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  scanMatchFrame: {
    marginBottom: spacing.sm,
  },
  scanMatchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  scanMatchInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  scanMatchName: {
    fontSize: typography.bodyMedium.fontSize,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  scanMatchMeta: {
    ...typography.bodyCompact,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
  },
  // No results
  scanNoResults: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  scanNoResultsText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },
});
