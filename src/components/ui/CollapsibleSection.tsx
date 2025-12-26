import React, { useEffect } from 'react';
import { StyleSheet, View, Text, StyleProp, ViewStyle } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  interpolate,
  runOnJS,
} from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, darkColors } from '@/theme/colors';
import { typography } from '@/theme/typography';
import { spacing } from '@/theme/spacing';
import { useTheme } from '@/providers/ThemeContext';
import { AnimatedPressable } from './AnimatedPressable';

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
}: CollapsibleSectionProps) {
  const { isDark } = useTheme();

  const animation = useSharedValue(expanded ? 1 : 0);
  const measuredHeight = useSharedValue(estimatedHeight);

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

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(animation.value, [0, 1], [0, 180])}deg` }],
  }));

  const handlePress = () => {
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
      <AnimatedPressable
        onPress={handlePress}
        pressScale={0.99}
        hapticType="light"
        style={styles.header}
      >
        <View style={styles.headerLeft}>
          {icon && (
            <MaterialCommunityIcons
              name={icon}
              size={22}
              color={isDark ? darkColors.textSecondary : colors.textSecondary}
              style={styles.icon}
            />
          )}
          <View>
            <Text style={[styles.title, { color: isDark ? darkColors.textPrimary : colors.textPrimary }]}>
              {title}
            </Text>
            {subtitle && (
              <Text style={[styles.subtitle, { color: isDark ? darkColors.textSecondary : colors.textSecondary }]}>
                {subtitle}
              </Text>
            )}
          </View>
        </View>
        <Animated.View style={chevronStyle}>
          <MaterialCommunityIcons
            name="chevron-down"
            size={24}
            color={isDark ? darkColors.textSecondary : colors.textSecondary}
          />
        </Animated.View>
      </AnimatedPressable>

      {showDivider && (
        <View style={[styles.divider, { backgroundColor: isDark ? darkColors.divider : colors.divider }]} />
      )}

      <Animated.View style={contentStyle}>
        <View onLayout={onContentLayout} style={styles.content}>
          {children}
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
    marginTop: 2,
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
