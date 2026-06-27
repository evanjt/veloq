import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { spacing } from '@/theme';

interface DebugWarning {
  level: 'warn' | 'error';
  message: string;
}

interface DebugWarningBannerProps {
  warnings: DebugWarning[];
}

const WARN_BG = '#fef3c7';
const WARN_BORDER = '#f59e0b';
const ERROR_BG = '#fee2e2';
const ERROR_BORDER = '#ef4444';

export function DebugWarningBanner({ warnings }: DebugWarningBannerProps) {
  if (warnings.length === 0) return null;

  return (
    <View style={styles.container}>
      {warnings.map((w, i) => {
        const isError = w.level === 'error';
        return (
          <View
            key={i}
            style={[
              styles.banner,
              {
                backgroundColor: isError ? ERROR_BG : WARN_BG,
                borderLeftColor: isError ? ERROR_BORDER : WARN_BORDER,
              },
            ]}
          >
            <MaterialCommunityIcons
              name={isError ? 'alert-circle' : 'alert'}
              size={16}
              color={isError ? ERROR_BORDER : WARN_BORDER}
            />
            <Text style={[styles.text, { color: isError ? '#991b1b' : '#92400e' }]}>
              {w.message}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    gap: 4,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderLeftWidth: 3,
  },
  text: {
    fontSize: 12,
    fontFamily: 'monospace',
    flex: 1,
  },
});
