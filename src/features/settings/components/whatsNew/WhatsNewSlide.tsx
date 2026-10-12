import React, { useState } from 'react';
import { View, StyleSheet, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/shared/app';
import { SectionTitle } from '@/shared/ui/SectionTitle';
import { colors, darkColors, spacing, typography } from '@/theme';
import {
  TOUR_PICTURE_GAP,
  TOUR_SLIDE_PADDING_TOP,
  tourPictureScale,
  tourPictureSpace,
} from '../../lib/tourSlideFit';

interface WhatsNewSlideProps {
  icon: string;
  title: string;
  body: string;
  /** The height the slide may take; its picture shrinks to fit under the text. */
  availableHeight?: number;
  children?: React.ReactNode;
}

export function WhatsNewSlide({
  icon,
  title,
  body,
  availableHeight,
  children,
}: WhatsNewSlideProps) {
  const { isDark } = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  const [headerHeight, setHeaderHeight] = useState(0);
  const [pictureHeight, setPictureHeight] = useState(0);

  const onHeaderLayout = (event: LayoutChangeEvent) =>
    setHeaderHeight(event.nativeEvent.layout.height);
  const onPictureLayout = (event: LayoutChangeEvent) =>
    setPictureHeight(event.nativeEvent.layout.height);

  const scale =
    availableHeight === undefined || headerHeight === 0
      ? 1
      : tourPictureScale(pictureHeight, tourPictureSpace(availableHeight, headerHeight));
  const frameStyle = pictureHeight > 0 ? { height: pictureHeight * scale } : undefined;

  return (
    <View style={[styles.container, { width: windowWidth - spacing.xl * 2 }]}>
      <View style={styles.header} onLayout={onHeaderLayout} testID="tour-slide-header">
        <MaterialCommunityIcons
          name={icon as keyof typeof MaterialCommunityIcons.glyphMap}
          size={40}
          color={isDark ? darkColors.primary : colors.primary}
        />
        <SectionTitle align="center" style={styles.title}>
          {title}
        </SectionTitle>
        <Text
          style={[styles.body, { color: isDark ? darkColors.textSecondary : colors.textSecondary }]}
        >
          {body}
        </Text>
      </View>
      {children && (
        <View style={[styles.frame, frameStyle]} testID="tour-slide-picture">
          <View
            style={[styles.content, { transform: [{ scale }] }]}
            onLayout={onPictureLayout}
            testID="tour-slide-picture-content"
          >
            {children}
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: TOUR_SLIDE_PADDING_TOP,
  },
  header: {
    alignItems: 'center',
    alignSelf: 'stretch',
    gap: spacing.sm,
  },
  title: {
    marginTop: spacing.sm,
  },
  body: {
    fontSize: typography.bodyMedium.fontSize,
    textAlign: 'center',
    lineHeight: 22,
  },
  frame: {
    marginTop: TOUR_PICTURE_GAP,
    width: '100%',
  },
  content: {
    width: '100%',
    alignItems: 'center',
    // Shrinks from the top edge, so the picture stays under the text.
    transformOrigin: 'top',
  },
});
