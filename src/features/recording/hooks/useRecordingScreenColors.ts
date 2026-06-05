import { useTheme } from '@/shared/app';
import { colors, darkColors } from '@/theme';

export function useRecordingScreenColors() {
  const { isDark } = useTheme();
  return {
    textPrimary: isDark ? darkColors.textPrimary : colors.textPrimary,
    textSecondary: isDark ? darkColors.textSecondary : colors.textSecondary,
    bg: isDark ? darkColors.background : colors.background,
    surface: isDark ? darkColors.surface : colors.surface,
    border: isDark ? darkColors.border : colors.border,
  };
}
