import type { ComponentProps } from 'react';
import type { MaterialCommunityIcons } from '@expo/vector-icons';

import { colors, darkColors } from '@/theme';
import type { RecordingUploadStatus } from '@/types';

export interface UploadStatusTone {
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  color: string;
}

/**
 * The status marks on a recording's upload chip. The colour draws the label and
 * the icon, and a 12 per cent tint of it is the chip, so it is a text tone held
 * to 4.5:1 on that tint over the theme's surface. A function of the theme
 * rather than a constant: no single value clears that on both white and
 * near-black.
 */
export function uploadStatusTone(isDark: boolean): Record<RecordingUploadStatus, UploadStatusTone> {
  return {
    localOnly: {
      icon: 'cellphone',
      color: isDark ? darkColors.textSecondary : colors.textSecondary,
    },
    pending: {
      icon: 'cloud-upload-outline',
      color: isDark ? darkColors.infoText : colors.infoText,
    },
    uploading: { icon: 'cloud-upload', color: isDark ? darkColors.infoText : colors.infoText },
    uploaded: {
      icon: 'cloud-check-outline',
      color: isDark ? darkColors.successChipText : colors.successChipText,
    },
    failed: { icon: 'cloud-alert', color: isDark ? darkColors.errorDeep : colors.errorDeep },
    permissionBlocked: {
      icon: 'shield-lock-outline',
      color: isDark ? darkColors.warningAmber : colors.warningAmber,
    },
  };
}
