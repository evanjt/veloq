/**
 * Section mini preview with lazy-loaded polyline.
 * Wraps MiniTraceView and handles loading polyline from Rust engine.
 */

import React from 'react';
import { View, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useSectionPolyline } from '@/hooks';
import { colors, darkColors } from '@/theme';
import { MiniTraceView } from './MiniTraceView';
import type { RoutePoint } from '@/types';

interface SectionMiniPreviewProps {
  /** Section ID for lazy loading polyline */
  sectionId: string;
  /** Pre-loaded polyline (if available, skips lazy loading) */
  polyline?: RoutePoint[];
  /** Color for the trace */
  color: string;
  /** Width of the preview (default 56) */
  width?: number;
  /** Height of the preview (default 40) */
  height?: number;
  /** Size of the preview - sets both width and height (default 56) */
  size?: number;
  /** Whether dark mode is enabled */
  isDark?: boolean;
}

export function SectionMiniPreview({
  sectionId,
  polyline: providedPolyline,
  color,
  width: propWidth,
  height: propHeight,
  size = 56,
  isDark = false,
}: SectionMiniPreviewProps) {
  // Calculate dimensions
  const width = propWidth ?? size;
  const height = propHeight ?? (propWidth ? 40 : size);

  // Only lazy-load if no polyline provided or it's empty
  const shouldLazyLoad = !providedPolyline?.length;
  const { polyline: lazyPolyline } = useSectionPolyline(shouldLazyLoad ? sectionId : null);

  // Use provided polyline or lazy-loaded one
  const polyline = providedPolyline?.length ? providedPolyline : lazyPolyline;

  if (polyline && polyline.length > 1) {
    return (
      <MiniTraceView
        primaryPoints={polyline}
        primaryColor={color}
        referenceColor={color}
        width={width}
        height={height}
        isDark={isDark}
      />
    );
  }

  // Fallback icon when no polyline available
  return (
    <View style={[styles.iconContainer, { width, height }]}>
      <MaterialCommunityIcons
        name="road-variant"
        size={Math.min(width, height) * 0.5}
        color={isDark ? darkColors.textMuted : colors.primary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  iconContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});
