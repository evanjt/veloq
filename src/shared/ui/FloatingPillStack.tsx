/**
 * The one stack of status pills, mounted at the root so every pill shows on
 * every route: a pill moves nothing under it, and a sync can start anywhere.
 *
 * Each pill draws in a slot of its own. A slot reports how tall its pill came
 * out, since the words wrap with the text size, and the position owner places
 * the shown pills one below the other from those heights. A pill that draws
 * nothing lays out at no height and gives up its place, so the pills below it
 * close the gap. A pill not measured yet takes the place past the shown ones,
 * where it covers none of them.
 */

import React, { useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { useFloatingPillTops } from '@/shared/app/TopSafeAreaContext';
import { floatingLayers, spacing } from '@/theme';
import { OfflinePill, PausedSyncPill } from './StatusPills';
import { SyncPill } from './SyncPill';

/**
 * The pills from the top down: why nothing new arrives comes first, then why a
 * sync waits, then the sync that runs.
 */
const STATUS_PILLS = [
  ['offline', <OfflinePill key="offline" />],
  ['paused', <PausedSyncPill key="paused" />],
  ['sync', <SyncPill key="sync" />],
] as const satisfies readonly (readonly [string, ReactNode])[];

type StatusPillKey = (typeof STATUS_PILLS)[number][0];

export function FloatingPillStack() {
  const [heights, setHeights] = useState<Partial<Record<StatusPillKey, number>>>({});

  const shown = STATUS_PILLS.map(([key]) => key).filter((key) => (heights[key] ?? 0) > 0);
  // One place past the shown pills, so every place asked for exists.
  const tops = useFloatingPillTops([...shown.map((key) => heights[key] ?? 0), 0]);
  const topOf = (key: StatusPillKey) => {
    const index = shown.indexOf(key);
    return tops[index === -1 ? shown.length : index];
  };

  const measure = (key: StatusPillKey) => (event: LayoutChangeEvent) => {
    const height = event.nativeEvent.layout.height;
    setHeights((current) => (current[key] === height ? current : { ...current, [key]: height }));
  };

  return (
    <>
      {STATUS_PILLS.map(([key, pill]) => (
        <View
          key={key}
          testID={`floating-pill-${key}`}
          style={[styles.slot, { top: topOf(key) }]}
          pointerEvents="none"
          onLayout={measure(key)}
        >
          {pill}
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  slot: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    alignItems: 'center',
    zIndex: floatingLayers.statusPills,
  },
});
