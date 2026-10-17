import React, { useState } from 'react';
import { View, StyleSheet, useWindowDimensions, type LayoutChangeEvent } from 'react-native';
import { Text } from 'react-native-paper';
import type { MaterialCommunityIcons } from '@expo/vector-icons';
import { ScrollView } from 'react-native-gesture-handler';
import { useTheme } from '@/shared/app';
import { SectionTitle } from '@/shared/ui/SectionTitle';
import { colors, darkColors, iconSize, spacing, typography } from '@/theme';
import {
  TOUR_PICTURE_GAP,
  TOUR_SLIDE_PADDING_TOP,
  tourCardWidth,
  tourSlideLayout,
} from '../../lib/tourSlideFit';
import { Icon } from '@/shared/ui/Icon';

interface WhatsNewSlideProps {
  icon: string;
  title: string;
  body: string;
  /**
   * The height the slide may take; its picture shrinks to fit under the text,
   * and the text scrolls once the picture is at its floor.
   */
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

  const {
    pictureScale: scale,
    scrolls,
    textHeight,
  } = availableHeight === undefined
    ? { pictureScale: 1, scrolls: false, textHeight: undefined }
    : tourSlideLayout(availableHeight, headerHeight, pictureHeight);
  const frameStyle = pictureHeight > 0 ? { height: pictureHeight * scale } : undefined;

  return (
    <View style={[styles.container, { width: tourCardWidth(windowWidth) }]}>
      {/* The handler's own scroll view, so a vertical drag scrolls and a horizontal one turns. */}
      <ScrollView
        style={[styles.text, scrolls ? { maxHeight: textHeight } : undefined]}
        scrollEnabled={scrolls}
        showsVerticalScrollIndicator={scrolls}
        persistentScrollbar={scrolls}
        testID="tour-slide-text"
      >
        <View style={styles.header} onLayout={onHeaderLayout} testID="tour-slide-header">
          <Icon
            name={icon as keyof typeof MaterialCommunityIcons.glyphMap}
            size={iconSize.xxl}
            color={isDark ? darkColors.actionPrimary : colors.actionPrimary}
          />
          <SectionTitle align="center" style={styles.title}>
            {title}
          </SectionTitle>
          <Text
            style={[
              styles.body,
              { color: isDark ? darkColors.textSecondary : colors.textSecondary },
            ]}
          >
            {body}
          </Text>
        </View>
      </ScrollView>
      {children ? (
        <View style={[styles.frame, frameStyle]} testID="tour-slide-picture">
          <View
            style={[styles.content, { transform: [{ scale }] }]}
            onLayout={onPictureLayout}
            testID="tour-slide-picture-content"
          >
            {children}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: TOUR_SLIDE_PADDING_TOP,
  },
  text: {
    alignSelf: 'stretch',
    flexGrow: 0,
  },
  header: {
    alignItems: 'center',
    gap: spacing.sm,
  },
  title: {
    marginTop: spacing.sm,
  },
  body: {
    ...typography.bodyMedium,
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
