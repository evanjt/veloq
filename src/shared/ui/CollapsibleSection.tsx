import React, { useEffect, useState } from 'react';
import { StyleSheet, View, Text, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  interpolate,
} from 'react-native-reanimated';
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import {
  colors,
  darkColors,
  duration,
  easing,
  iconSize,
  layout,
  spacing,
  typography,
} from '@/theme';
import { useTheme } from '@/shared/app';
import { Icon } from './Icon';
import { composeAccessibilityLabel } from './accessibilityLabel';
import { DisclosureChevron } from './DisclosureChevron';
import { FitText } from './FitText';
import * as haptics from './haptics';
import { HeadingControl } from './HeadingControl';

interface CollapsibleSectionProps {
  /** Section title */
  title: string;
  /** Whether the section is expanded */
  expanded: boolean;
  /** Toggle handler */
  onToggle: (expanded: boolean) => void;
  /** Section content */
  children: React.ReactNode;
  /** Optional subtitle */
  subtitle?: string;
  /** Optional icon */
  icon?: keyof typeof MaterialCommunityIcons.glyphMap;
  /** Additional container style */
  style?: StyleProp<ViewStyle>;
  /** Content height hint (for smoother animations) */
  estimatedHeight?: number;
  /** Optional content to render on the right side of the header (before chevron) */
  headerRight?: React.ReactNode;
  /** A short summary drawn at the header's trailing edge and read after the title. */
  value?: string;
  /** Optional test ID for the header */
  testID?: string;
}

export function CollapsibleSection({
  title,
  expanded,
  onToggle,
  children,
  subtitle,
  icon,
  style,
  estimatedHeight = 200,
  headerRight,
  value,
  testID,
}: CollapsibleSectionProps) {
  const { isDark } = useTheme();

  // Defer child mounting until section has been expanded at least once.
  // Sections that start collapsed render null children, avoiding expensive
  // mounts (e.g., Victory Native charts) until the user opens them.
  // Once expanded, children stay mounted so re-collapsing is instant.
  const [hasEverExpanded, setHasEverExpanded] = useState(expanded);

  const animation = useSharedValue(expanded ? 1 : 0);
  const measuredHeight = useSharedValue(estimatedHeight);

  // Mounting the children is a render decision, so it is taken while
  // rendering: an effect would open the section one commit before its content
  // existed. The animation is an animation and stays in the effect.
  if (expanded && !hasEverExpanded) {
    setHasEverExpanded(true);
  }
  useEffect(() => {
    animation.value = withTiming(expanded ? 1 : 0, {
      duration: duration.standard,
      easing: easing.standard,
    });
  }, [expanded, animation]);

  const contentStyle = useAnimatedStyle(() => ({
    height: interpolate(animation.value, [0, 1], [0, measuredHeight.value]),
    opacity: animation.value,
    overflow: 'hidden',
  }));

  // An expand is a discrete toggle, so it ticks once on the press itself and
  // never on touch-down, where a scroll may still take the touch.
  const handlePress = () => {
    haptics.selection();
    onToggle(!expanded);
  };

  const onContentLayout = (event: { nativeEvent: { layout: { height: number } } }) => {
    const { height } = event.nativeEvent.layout;
    if (height > 0) {
      measuredHeight.value = height;
    }
  };

  return (
    <View style={[styles.container, style]}>
      <HeadingControl
        testID={testID}
        accessibilityLabel={composeAccessibilityLabel(title, value)}
        accessibilityState={{ expanded }}
        onPress={handlePress}
        style={styles.header}
      >
        <View style={styles.headerLeft}>
          {icon ? (
            <Icon
              name={icon}
              size={iconSize.lg}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
              style={styles.icon}
            />
          ) : null}
          <View>
            <Text
              style={[
                styles.title,
                { color: isDark ? darkColors.textPrimary : colors.textPrimary },
              ]}
            >
              {title}
            </Text>
            {subtitle ? (
              <Text
                style={[
                  styles.subtitle,
                  {
                    color: isDark ? darkColors.textSecondary : colors.textSecondary,
                  },
                ]}
              >
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>
        {value ? (
          <FitText
            style={[
              styles.value,
              { color: isDark ? darkColors.textSecondary : colors.textSecondary },
            ]}
          >
            {value}
          </FitText>
        ) : null}
        {headerRight}
        <DisclosureChevron
          expanded={expanded}
          size={iconSize.lg}
          color={isDark ? darkColors.textSecondary : colors.textSecondary}
        />
      </HeadingControl>

      <Animated.View style={contentStyle}>
        <View onLayout={onContentLayout} style={styles.content}>
          {hasEverExpanded ? children : null}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: layout.minTapTarget,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  icon: {
    marginRight: spacing.sm,
  },
  title: {
    ...typography.bodyBold,
  },
  subtitle: {
    ...typography.caption,
    marginTop: spacing.xxs,
  },
  value: {
    ...typography.bodySmall,
    flexShrink: 1,
    marginHorizontal: spacing.xs,
  },
  content: {
    position: 'absolute',
    width: '100%',
  },
});

export default CollapsibleSection;
