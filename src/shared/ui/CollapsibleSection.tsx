import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, View, Text, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  interpolate,
} from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, darkColors, layout, typography, spacing } from '@/theme';
import { useTheme } from '@/shared/app';
import { DisclosureChevron } from './DisclosureChevron';
import * as haptics from './haptics';
import { pressable, pressRipple } from './pressFeedback';

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
  /** Whether to show divider below header */
  showDivider?: boolean;
  /** Optional content to render on the right side of the header (before chevron) */
  headerRight?: React.ReactNode;
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
  showDivider = false,
  headerRight,
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
      duration: 250,
      easing: Easing.bezier(0.4, 0, 0.2, 1),
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
      {/* A container's header role is not read on the control inside it, so it goes here. */}
      <Pressable
        testID={testID}
        accessibilityRole="header"
        accessibilityLabel={title}
        accessibilityState={{ expanded }}
        onPress={handlePress}
        style={pressable(styles.header)}
        android_ripple={pressRipple}
      >
        <View style={styles.headerLeft}>
          {icon ? (
            <MaterialCommunityIcons
              name={icon}
              size={22}
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
        {headerRight}
        <DisclosureChevron
          expanded={expanded}
          size={24}
          color={isDark ? darkColors.textSecondary : colors.textSecondary}
        />
      </Pressable>

      {showDivider ? (
        <View
          style={[
            styles.divider,
            { backgroundColor: isDark ? darkColors.divider : colors.divider },
          ]}
        />
      ) : null}

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
  divider: {
    height: StyleSheet.hairlineWidth,
    marginHorizontal: spacing.md,
  },
  content: {
    position: 'absolute',
    width: '100%',
  },
});

export default CollapsibleSection;
