import React from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { Text } from 'react-native-paper';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useTheme } from '@/hooks';
import { colors, darkColors, spacing } from '@/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface WhatsNewSlideProps {
  icon: string;
  title: string;
  body: string;
  children?: React.ReactNode;
}

export function WhatsNewSlide({ icon, title, body, children }: WhatsNewSlideProps) {
  const { isDark } = useTheme();

  return (
    <View style={[styles.container, { width: SCREEN_WIDTH - spacing.xl * 2 }]}>
      <MaterialCommunityIcons
        name={icon as keyof typeof MaterialCommunityIcons.glyphMap}
        size={40}
        color={isDark ? darkColors.primary : colors.primary}
      />
      <Text style={[styles.title, { color: isDark ? darkColors.textPrimary : colors.textPrimary }]}>
        {title}
      </Text>
      <Text
        style={[styles.body, { color: isDark ? darkColors.textSecondary : colors.textSecondary }]}
      >
        {body}
      </Text>
      {children && <View style={styles.content}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    gap: spacing.sm,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: spacing.sm,
  },
  body: {
    fontSize: 15,
    textAlign: 'center',
    lineHeight: 22,
  },
  content: {
    marginTop: spacing.md,
    width: '100%',
    alignItems: 'center',
  },
});
