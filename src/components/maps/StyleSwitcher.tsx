/**
 * @fileoverview StyleSwitcher - Map style toggle button
 *
 * Provides a floating button to cycle through map styles (standard → satellite → terrain).
 * Respects user preferences and persists manual overrides within the component lifecycle.
 */

import React, { useState, useCallback, useEffect } from "react";
import { TouchableOpacity, StyleSheet, ViewStyle } from "react-native";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useMapPreferences } from "@/providers";
import { colors } from "@/theme/colors";
import { shadows } from "@/theme/shadows";
import { spacing } from "@/theme/spacing";
import { type MapStyleType, getNextStyle, getStyleIcon } from "./mapStyles";
import { getActivityColor } from "@/lib";
import type { ActivityType } from "@/types";

interface StyleSwitcherProps {
  /** Current activity type for style preference lookup */
  activityType: ActivityType;
  /** Current map style */
  currentStyle: MapStyleType;
  /** Initial style (prevents auto-applying preference) */
  initialStyle?: MapStyleType;
  /** Called when style changes */
  onStyleChange: (style: MapStyleType) => void;
  /** Optional container style */
  style?: ViewStyle;
}

/**
 * Map style toggle button.
 *
 * Cycles through map styles: standard → satellite → terrain → standard.
 * Respects user preferences from MapPreferencesContext unless manually overridden.
 *
 * @example
 * ```tsx
 * <StyleSwitcher
 *   activityType="Ride"
 *   currentStyle={mapStyle}
 *   onStyleChange={setMapStyle}
 * />
 * ```
 */
export function StyleSwitcher({
  activityType,
  currentStyle,
  initialStyle,
  onStyleChange,
  style,
}: StyleSwitcherProps) {
  const { getStyleForActivity } = useMapPreferences();
  const preferredStyle = getStyleForActivity(activityType);

  // Track if user manually overrode the style
  const [userOverride, setUserOverride] = useState(false);

  // Update style when preference changes (unless user manually toggled)
  useEffect(() => {
    if (!userOverride && !initialStyle && currentStyle !== preferredStyle) {
      onStyleChange(preferredStyle);
    }
  }, [userOverride, initialStyle, currentStyle, preferredStyle, onStyleChange]);

  // Cycle to next style
  const handleToggle = useCallback(() => {
    const nextStyle = getNextStyle(currentStyle);
    setUserOverride(true); // Don't auto-switch anymore
    onStyleChange(nextStyle);
  }, [currentStyle, onStyleChange]);

  const iconName = getStyleIcon(currentStyle);
  const tintColor = getActivityColor(activityType);

  return (
    <TouchableOpacity
      style={[styles.button, style]}
      onPress={handleToggle}
      activeOpacity={0.7}
      accessibilityLabel="Toggle map style"
      accessibilityHint="Cycles through standard, satellite, and terrain map styles"
    >
      <MaterialCommunityIcons name={iconName} size={28} color={tintColor} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    position: "absolute",
    top: spacing.md,
    right: spacing.md,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surface,
    justifyContent: "center",
    alignItems: "center",
    ...shadows.card,
  },
});
